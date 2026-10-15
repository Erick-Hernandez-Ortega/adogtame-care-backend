import { configureSecurityHeaders } from '../src/infrastructure/http/configure-security-headers';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { accounts } from '../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { ListMyPets } from '../src/pet-management/application/list-my-pets/list-my-pets';

interface ProtectedOperation {
    readonly method: 'get' | 'post' | 'patch' | 'delete';
    readonly path: string;
}

describe('API security (e2e)', () => {
    let application: INestApplication<App>;
    let operations: ProtectedOperation[];
    let token: string;
    let accountId: string;

    beforeAll(async (): Promise<void> => {
        const fixture = await Test.createTestingModule({ imports: [AppModule] }).compile();

        application = fixture.createNestApplication();
        configureSecurityHeaders(application);
        await application.init();
        const document: OpenAPIObject = SwaggerModule.createDocument(
            application,
            new DocumentBuilder().addBearerAuth().build(),
        );

        operations = [];

        for (const [path, entry] of Object.entries(document.paths)) {
            for (const method of ['get', 'post', 'patch', 'delete'] as const) {
                if (entry?.[method]?.security?.length) {
                    operations.push({ method, path: path.replace(/\{[^}]+\}/g, randomUUID()) });
                }
            }
        }

        const email: string = `${randomUUID()}@example.com`;
        const password: string = 'a secure password';
        const registered = await request(application.getHttpServer())
            .post('/accounts')
            .send({ email, password })
            .expect(201);
        const loggedIn = await request(application.getHttpServer())
            .post('/auth/login')
            .send({ email, password })
            .expect(200);

        accountId = (registered.body as { id: string }).id;
        token = (loggedIn.body as { accessToken: string }).accessToken;
    });

    afterAll(async (): Promise<void> => {
        if (accountId !== undefined) {
            await application
                .get(DatabaseService)
                .connection.delete(accounts)
                .where(eq(accounts.id, accountId));
        }

        await application.close();
    });

    it.each(['\u0000', 'prefix\u0000suffix', '\uD800', '\uDC00'])(
        'rejects PostgreSQL-incompatible shared cursor keys %j',
        async (key: string): Promise<void> => {
            const cursor: string = Buffer.from(
                JSON.stringify({
                    v: 1,
                    scope: JSON.stringify(['pets', accountId]),
                    after: [key, randomUUID()],
                }),
            ).toString('base64url');
            const response = await request(application.getHttpServer())
                .get('/pets')
                .query({ cursor })
                .set('Authorization', `Bearer ${token}`)
                .expect(400);

            expect(response.body).toEqual({
                code: 'INVALID_REQUEST',
                message: 'Request query is invalid',
            });
        },
    );

    it('authenticates before malformed, scalar and oversized JSON on every protected operation', async (): Promise<void> => {
        expect(operations).toHaveLength(49);

        for (const operation of operations) {
            for (const body of [
                '{"broken":',
                'true',
                JSON.stringify({ value: 'x'.repeat(102401) }),
            ]) {
                for (const authorization of [undefined, 'Bearer invalid', `Bearer ${token}`]) {
                    const pending = request(application.getHttpServer())
                        [operation.method](operation.path)
                        .set('Content-Type', 'application/json')
                        .send(body);

                    if (authorization !== undefined) {
                        pending.set('Authorization', authorization);
                    }

                    const isAuthenticated: boolean = authorization === `Bearer ${token}`;
                    const response = await pending.expect(
                        isAuthenticated ? (body.length > 102400 ? 413 : 400) : 401,
                    );

                    expect(response.body).toEqual({
                        code: isAuthenticated ? 'INVALID_REQUEST' : 'UNAUTHENTICATED',
                        message: isAuthenticated
                            ? body.length > 102400
                                ? 'Request body is too large'
                                : 'Request body is invalid'
                            : 'Authentication is required',
                    });
                }
            }
        }
    }, 30000);

    it('does not expose unexpected exception messages, database details or stack traces', async (): Promise<void> => {
        const useCase: ListMyPets = application.get(ListMyPets);
        const originalExecute: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(
            useCase,
            'execute',
        );

        useCase.execute = (): Promise<never> =>
            Promise.reject(new Error('secret SQL database detail'));

        try {
            const response = await request(application.getHttpServer())
                .get('/pets')
                .set('Authorization', `Bearer ${token}`)
                .expect(500);

            expect(response.body).toEqual({ statusCode: 500, message: 'Internal server error' });
        } finally {
            if (originalExecute === undefined) {
                Reflect.deleteProperty(useCase, 'execute');
            } else {
                Object.defineProperty(useCase, 'execute', originalExecute);
            }
        }
    });

    it('bounds previously unbounded profile and credential transport strings', async (): Promise<void> => {
        for (const body of [{ name: 'x'.repeat(256) }, { distinctiveMarks: 'x'.repeat(2001) }]) {
            await request(application.getHttpServer())
                .post('/pets')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    name: 'Luna',
                    species: 'DOG',
                    breed: { name: 'Mixed', kind: 'CUSTOM' },
                    sex: 'UNKNOWN',
                    birthInformation: { date: '2020-01-01', accuracy: 'EXACT' },
                    ...body,
                })
                .expect(400);
        }

        await request(application.getHttpServer())
            .post('/auth/login')
            .send({ email: 'x'.repeat(509), password: 'password' })
            .expect(400);
        await request(application.getHttpServer())
            .post('/accounts')
            .send({ email: 'person@example.com', password: 'x'.repeat(257) })
            .expect(400);
    });

    it('rejects invalid pagination before accessing persistence on every list', async (): Promise<void> => {
        for (const operation of operations.filter(
            (operation): boolean =>
                operation.method === 'get' &&
                (operation.path === '/pets' || !/^\/pets\/[^/]+$/.test(operation.path)),
        )) {
            for (const query of [
                'limit=0',
                'limit=101',
                'limit=01',
                'limit=1&limit=2',
                'cursor=!',
                'limit[x]=1',
            ]) {
                const response = await request(application.getHttpServer())
                    .get(`${operation.path}?${query}`)
                    .set('Authorization', `Bearer ${token}`)
                    .expect(400);

                expect(response.body).toMatchObject({ code: 'INVALID_REQUEST' });
            }
        }
    });
});
