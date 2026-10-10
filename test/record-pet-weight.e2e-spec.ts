import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { healthWeightRecords } from '../src/health/infrastructure/persistence/drizzle/health.schema';
import { accounts } from '../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import {
    petMemberships,
    pets,
} from '../src/pet-management/infrastructure/persistence/drizzle/pet-management.schema';

interface AccountFixture {
    id: string;
    token: string;
}

describe('POST /pets/:petId/health/weight-records (e2e)', () => {
    let application: INestApplication<App>;
    let database: DatabaseService;
    let owner: AccountFixture;
    let collaborator: AccountFixture;
    let outsider: AccountFixture;
    let petId: string;

    async function account(label: string): Promise<AccountFixture> {
        const email = `${label}-${randomUUID()}@example.com`;
        const password = 'a secure password';
        const registration = await request(application.getHttpServer())
            .post('/accounts')
            .send({ email, password })
            .expect(201);
        const login = await request(application.getHttpServer())
            .post('/auth/login')
            .send({ email, password })
            .expect(200);

        return {
            id: (registration.body as { id: string }).id,
            token: (login.body as { accessToken: string }).accessToken,
        };
    }

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        application = moduleFixture.createNestApplication();
        await application.init();
        database = application.get(DatabaseService);
        owner = await account('weight-owner');
        collaborator = await account('weight-collaborator');
        outsider = await account('weight-outsider');
    });

    afterAll(async () => {
        for (const fixture of [owner, collaborator, outsider]) {
            await database.connection.delete(accounts).where(eq(accounts.id, fixture.id));
        }

        await application.close();
    });

    beforeEach(async () => {
        const response = await request(application.getHttpServer())
            .post('/pets')
            .set('Authorization', `Bearer ${owner.token}`)
            .send({
                name: 'Luna',
                species: 'DOG',
                breed: { name: 'Mixed', kind: 'CUSTOM' },
                sex: 'FEMALE',
                birthInformation: { date: '2020-01-01', accuracy: 'EXACT' },
            })
            .expect(201);

        petId = (response.body as { id: string }).id;
        await database.connection.insert(petMemberships).values({
            id: randomUUID(),
            petId,
            accountId: collaborator.id,
            role: 'COLLABORATOR',
            status: 'ACTIVE',
        });
    });

    afterEach(async () => {
        await database.connection
            .delete(healthWeightRecords)
            .where(eq(healthWeightRecords.petId, petId));
        await database.connection.delete(petMemberships).where(eq(petMemberships.petId, petId));
        await database.connection.delete(pets).where(eq(pets.id, petId));
    });

    function path(id: string = petId): string {
        return `/pets/${id}/health/weight-records`;
    }

    function body(weightKg = '12.3456', measuredDate = '2020-01-01') {
        return { weightKg, measuredDate };
    }

    it('lets active owner and collaborator record multiple measurements on the same date', async () => {
        for (const accountFixture of [owner, collaborator]) {
            const response = await request(application.getHttpServer())
                .post(path())
                .set('Authorization', `Bearer ${accountFixture.token}`)
                .send(body())
                .expect(201);

            expect(response.body).toEqual({
                id: expect.any(String) as string,
                petId,
                weightKg: '12.3456',
                measuredDate: '2020-01-01',
                recordedByAccountId: accountFixture.id,
            });
        }

        const rows = await database.connection
            .select()
            .from(healthWeightRecords)
            .where(eq(healthWeightRecords.petId, petId));

        expect(rows).toHaveLength(2);
        expect(rows[0]?.id).not.toBe(rows[1]?.id);
    });

    it.each(['0', '-1', '12.34567'])('rejects invalid weight %s', async (weightKg) => {
        const response = await request(application.getHttpServer())
            .post(path())
            .set('Authorization', `Bearer ${owner.token}`)
            .send(body(weightKg))
            .expect(400);

        expect(response.body).toMatchObject({ code: 'INVALID_WEIGHT' });
    });

    it.each(['2026-02-29', '9999-12-31'])(
        'rejects invalid or future measured date %s',
        async (measuredDate) => {
            const response = await request(application.getHttpServer())
                .post(path())
                .set('Authorization', `Bearer ${owner.token}`)
                .send(body('1', measuredDate))
                .expect(400);

            expect(response.body).toMatchObject({ code: 'INVALID_MEASURED_DATE' });
        },
    );

    it('hides archived, inactive, inaccessible and missing pets', async () => {
        const inaccessible = await request(application.getHttpServer())
            .post(path())
            .set('Authorization', `Bearer ${outsider.token}`)
            .send(body())
            .expect(404);

        expect(inaccessible.body).toMatchObject({
            code: 'PET_NOT_FOUND',
            message: 'Pet was not found',
        });
        await database.connection
            .update(petMemberships)
            .set({ status: 'INACTIVE' })
            .where(eq(petMemberships.accountId, collaborator.id));
        await request(application.getHttpServer())
            .post(path())
            .set('Authorization', `Bearer ${collaborator.token}`)
            .send(body())
            .expect(404);
        await database.connection
            .update(pets)
            .set({ status: 'ARCHIVED' })
            .where(eq(pets.id, petId));
        await request(application.getHttpServer())
            .post(path())
            .set('Authorization', `Bearer ${owner.token}`)
            .send(body())
            .expect(404);
        await request(application.getHttpServer())
            .post(path(randomUUID()))
            .set('Authorization', `Bearer ${owner.token}`)
            .send(body())
            .expect(404);
    });

    it('requires authentication and rejects invalid path, body fields and number weight', async () => {
        await request(application.getHttpServer()).post(path()).send(body()).expect(401);

        for (const response of [
            await request(application.getHttpServer())
                .post(path('bad-id'))
                .set('Authorization', `Bearer ${owner.token}`)
                .send(body())
                .expect(400),
            await request(application.getHttpServer())
                .post(path())
                .set('Authorization', `Bearer ${owner.token}`)
                .send({ ...body(), recordedByAccountId: outsider.id })
                .expect(400),
            await request(application.getHttpServer())
                .post(path())
                .set('Authorization', `Bearer ${owner.token}`)
                .send({ weightKg: 12.3456, measuredDate: '2020-01-01' })
                .expect(400),
        ]) {
            expect(response.body).toMatchObject({ code: 'INVALID_REQUEST' });
        }
    });
});
