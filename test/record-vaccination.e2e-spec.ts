import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { healthVaccinationRecords } from '../src/health/infrastructure/persistence/drizzle/health.schema';
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

describe('POST /pets/:petId/health/vaccination-records (e2e)', () => {
    let application: INestApplication<App>;
    let database: DatabaseService;
    let owner: AccountFixture;
    let collaborator: AccountFixture;
    let outsider: AccountFixture;
    let petId: string;
    let collaboratorMembershipId: string;

    async function createAccount(): Promise<AccountFixture> {
        const email: string = `${randomUUID()}@example.com`;
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
        const fixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        application = fixture.createNestApplication();
        await application.init();
        database = application.get(DatabaseService);
        owner = await createAccount();
        collaborator = await createAccount();
        outsider = await createAccount();
    });

    afterAll(async () => {
        for (const account of [owner, collaborator, outsider]) {
            await database.connection.delete(accounts).where(eq(accounts.id, account.id));
        }

        await application.close();
    });

    beforeEach(async () => {
        petId = randomUUID();
        collaboratorMembershipId = randomUUID();
        await database.connection.insert(pets).values({
            id: petId,
            name: 'Vaccination pet',
            species: 'DOG',
            breedName: 'Mixed',
            breedKind: 'CUSTOM',
            sex: 'UNKNOWN',
            birthDate: '2020-01-01',
            birthDateAccuracy: 'EXACT',
            status: 'ACTIVE',
        });
        await database.connection.insert(petMemberships).values([
            {
                id: randomUUID(),
                petId,
                accountId: owner.id,
                role: 'OWNER',
                status: 'ACTIVE',
            },
            {
                id: collaboratorMembershipId,
                petId,
                accountId: collaborator.id,
                role: 'COLLABORATOR',
                status: 'ACTIVE',
            },
        ]);
    });

    afterEach(async () => {
        await database.connection
            .delete(healthVaccinationRecords)
            .where(eq(healthVaccinationRecords.petId, petId));
        await database.connection.delete(petMemberships).where(eq(petMemberships.petId, petId));
        await database.connection.delete(pets).where(eq(pets.id, petId));
    });

    function path(id: string = petId): string {
        return `/pets/${id}/health/vaccination-records`;
    }

    function body() {
        return {
            vaccineName: '  Rabies  ',
            appliedDate: '2024-01-10',
            nextDueDate: '2025-01-10',
        };
    }

    it('allows owner and collaborator, overdue dates, null/omitted next dose, and exact duplicates', async () => {
        for (const account of [owner, collaborator]) {
            const response = await request(application.getHttpServer())
                .post(path())
                .set('Authorization', `Bearer ${account.token}`)
                .send(body())
                .expect(201);

            expect(response.body).toEqual({
                id: expect.any(String) as string,
                petId,
                vaccineName: 'Rabies',
                appliedDate: '2024-01-10',
                nextDueDate: '2025-01-10',
                recordedByAccountId: account.id,
            });
        }

        const duplicate = await request(application.getHttpServer())
            .post(path())
            .set('Authorization', `Bearer ${owner.token}`)
            .send(body())
            .expect(201);
        const omitted = await request(application.getHttpServer())
            .post(path())
            .set('Authorization', `Bearer ${owner.token}`)
            .send({ vaccineName: 'Rabies', appliedDate: '2024-01-10' })
            .expect(201);
        const explicitNull = await request(application.getHttpServer())
            .post(path())
            .set('Authorization', `Bearer ${owner.token}`)
            .send({
                vaccineName: 'Rabies',
                appliedDate: '2024-01-10',
                nextDueDate: null,
            })
            .expect(201);

        expect(omitted.body).toHaveProperty('nextDueDate', null);
        expect(explicitNull.body).toHaveProperty('nextDueDate', null);
        const rows = await database.connection
            .select()
            .from(healthVaccinationRecords)
            .where(eq(healthVaccinationRecords.petId, petId));

        expect(rows).toHaveLength(5);
        expect(new Set(rows.map((row) => row.id)).size).toBe(5);
        expect(rows.some((row) => row.id === (duplicate.body as { id: string }).id)).toBe(true);
    });

    it.each([
        [{ vaccineName: '', appliedDate: '2024-01-10' }, 'INVALID_VACCINE_NAME'],
        [{ vaccineName: ' ', appliedDate: '2024-01-10' }, 'INVALID_VACCINE_NAME'],
        [{ vaccineName: 'x'.repeat(256), appliedDate: '2024-01-10' }, 'INVALID_VACCINE_NAME'],
        [{ vaccineName: 'Rabies', appliedDate: '2026-02-29' }, 'INVALID_APPLIED_DATE'],
        [{ vaccineName: 'Rabies', appliedDate: '9999-12-31' }, 'INVALID_APPLIED_DATE'],
        [
            {
                vaccineName: 'Rabies',
                appliedDate: '2024-01-10',
                nextDueDate: '2024-01-10',
            },
            'INVALID_NEXT_DUE_DATE',
        ],
        [
            {
                vaccineName: 'Rabies',
                appliedDate: '2024-01-10',
                nextDueDate: '2024-01-09',
            },
            'INVALID_NEXT_DUE_DATE',
        ],
        [
            {
                vaccineName: 'Rabies',
                appliedDate: '2024-01-10',
                nextDueDate: '2025-02-29',
            },
            'INVALID_NEXT_DUE_DATE',
        ],
    ])('maps invalid domain value to %s', async (requestBody, code) => {
        const response = await request(application.getHttpServer())
            .post(path())
            .set('Authorization', `Bearer ${owner.token}`)
            .send(requestBody)
            .expect(400);

        expect(response.body).toMatchObject({ code });
    });

    it('rejects extra fields, wrong types, invalid pet UUID, and absent JWT', async () => {
        for (const requestBody of [
            { ...body(), recordedByAccountId: owner.id },
            { ...body(), id: randomUUID() },
            { ...body(), nextDueDate: 2027 },
            { appliedDate: '2024-01-10' },
        ]) {
            const response = await request(application.getHttpServer())
                .post(path())
                .set('Authorization', `Bearer ${owner.token}`)
                .send(requestBody)
                .expect(400);

            expect(response.body).toMatchObject({ code: 'INVALID_REQUEST' });
        }

        const badId = await request(application.getHttpServer())
            .post(path('bad'))
            .set('Authorization', `Bearer ${owner.token}`)
            .send(body())
            .expect(400);

        expect(badId.body).toMatchObject({ code: 'INVALID_REQUEST' });
        await request(application.getHttpServer()).post(path()).send(body()).expect(401);
    });

    it('hides archived, inactive, missing, and unjoined pets', async () => {
        const outsiderResponse = await request(application.getHttpServer())
            .post(path())
            .set('Authorization', `Bearer ${outsider.token}`)
            .send(body())
            .expect(404);

        expect(outsiderResponse.body).toMatchObject({
            code: 'PET_NOT_FOUND',
            message: 'Pet was not found',
        });
        await database.connection
            .update(petMemberships)
            .set({ status: 'INACTIVE' })
            .where(eq(petMemberships.id, collaboratorMembershipId));
        const inactive = await request(application.getHttpServer())
            .post(path())
            .set('Authorization', `Bearer ${collaborator.token}`)
            .send(body())
            .expect(404);

        expect(inactive.body).toMatchObject({ code: 'PET_NOT_FOUND' });
        await database.connection
            .update(pets)
            .set({ status: 'ARCHIVED' })
            .where(eq(pets.id, petId));
        const archived = await request(application.getHttpServer())
            .post(path())
            .set('Authorization', `Bearer ${owner.token}`)
            .send(body())
            .expect(404);

        expect(archived.body).toMatchObject({ code: 'PET_NOT_FOUND' });
        const missing = await request(application.getHttpServer())
            .post(path(randomUUID()))
            .set('Authorization', `Bearer ${owner.token}`)
            .send(body())
            .expect(404);

        expect(missing.body).toMatchObject({ code: 'PET_NOT_FOUND' });
    });
});
