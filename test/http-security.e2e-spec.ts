import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { validateEnvironment } from '../src/infrastructure/config/environment.validation';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { configureOpenApi } from '../src/infrastructure/http/configure-openapi';
import { configureSecurityHeaders } from '../src/infrastructure/http/configure-security-headers';

describe('HTTP security defaults (e2e)', () => {
    let application: INestApplication<App>;

    beforeEach(async (): Promise<void> => {
        const configuration = new ConfigService(
            validateEnvironment({
                ...process.env,
                THROTTLE_LIMIT: undefined,
                AUTH_THROTTLE_LIMIT: undefined,
            }),
        );
        const fixture = await Test.createTestingModule({ imports: [AppModule] })
            .overrideProvider(ConfigService)
            .useValue(configuration)
            .compile();

        application = fixture.createNestApplication();
        configureSecurityHeaders(application);
        configureOpenApi(application);
        await application.init();
    });

    afterEach(async (): Promise<void> => {
        await application?.close();
    });

    it('serves security headers on successful responses, errors, and Swagger assets', async (): Promise<void> => {
        for (const path of [
            '/',
            '/pets',
            '/docs',
            '/docs-json',
            '/docs/swagger-ui-init.js',
            '/docs/swagger-ui-bundle.js',
            '/docs/swagger-ui.css',
        ]) {
            const response = await request(application.getHttpServer())
                .get(path)
                .expect(path === '/pets' ? 401 : 200);

            expect(response.headers['x-content-type-options']).toBe('nosniff');
            expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
            expect(response.headers['strict-transport-security']).toBe(
                'max-age=31536000; includeSubDomains',
            );
            expect(response.headers['x-powered-by']).toBeUndefined();
            expect(response.headers['content-security-policy']).toContain("script-src 'self'");
            expect(response.headers['content-security-policy']).toContain(
                "style-src 'self' https: 'unsafe-inline'",
            );
            expect(response.headers['content-security-policy']).not.toContain(
                "script-src 'self' 'unsafe-inline'",
            );

            if (path === '/docs') {
                expect(response.text).toContain('swagger-ui');
                expect(response.text).toContain('./docs/swagger-ui-init.js');
                expect(response.text).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
            }
        }
    });

    it.each(['/auth/login', '/accounts'])(
        'allows ten requests and rejects the eleventh on %s, ignoring spoofed forwarding headers',
        async (path: string): Promise<void> => {
            for (let requestNumber: number = 1; requestNumber <= 10; requestNumber += 1) {
                await request(application.getHttpServer())
                    .post(path)
                    .set('X-Forwarded-For', `192.0.2.${requestNumber}`)
                    .send({})
                    .expect(400);
            }

            const response = await request(application.getHttpServer())
                .post(path)
                .set('X-Forwarded-For', '192.0.2.100')
                .send({})
                .expect(429);

            expect(response.body).toEqual({
                code: 'RATE_LIMIT_EXCEEDED',
                message: 'Too many requests',
            });
            expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
            expect(response.headers['x-content-type-options']).toBe('nosniff');

            const otherPath: string = path === '/accounts' ? '/auth/login' : '/accounts';

            await request(application.getHttpServer()).post(otherPath).send({}).expect(400);
            await request(application.getHttpServer()).get('/').expect(200);
        },
    );

    it('shares the global IP budget across routes and exempts health probes even when blocked', async (): Promise<void> => {
        application.get(DatabaseService).checkConnection = (): Promise<void> => Promise.resolve();

        for (let requestNumber: number = 0; requestNumber < 100; requestNumber += 1) {
            const isWelcome: boolean = requestNumber % 2 === 0;

            await request(application.getHttpServer())
                .get(isWelcome ? '/' : '/pets')
                .expect(isWelcome ? 200 : 401);
            await request(application.getHttpServer()).get('/health').expect(200);
        }

        const response = await request(application.getHttpServer()).get('/').expect(429);

        expect(response.body).toEqual({
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests',
        });
        expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
        await request(application.getHttpServer()).get('/pets').expect(429);
        const health = await request(application.getHttpServer()).get('/health').expect(200);

        expect(health.headers['x-ratelimit-limit']).toBeUndefined();
    });
});
