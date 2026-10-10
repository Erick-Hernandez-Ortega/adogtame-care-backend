import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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

describe('PATCH and DELETE pet weight records (e2e)', () => {
    let application: INestApplication<App>;
    let database: DatabaseService;
    let owner: AccountFixture;
    let collaborator: AccountFixture;
    let outsider: AccountFixture;
    let petId: string;
    let otherPetId: string;

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
        const fixture = await Test.createTestingModule({
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
        otherPetId = randomUUID();
        await database.connection.insert(pets).values(
            [petId, otherPetId].map((id) => ({
                id,
                name: 'Weight pet',
                species: 'DOG' as const,
                breedName: 'Mixed',
                breedKind: 'CUSTOM' as const,
                sex: 'UNKNOWN' as const,
                birthDate: '2020-01-01',
                birthDateAccuracy: 'EXACT' as const,
                status: 'ACTIVE' as const,
            })),
        );
        await database.connection.insert(petMemberships).values(
            [petId, otherPetId].map((id) => ({
                id: randomUUID(),
                petId: id,
                accountId: owner.id,
                role: 'OWNER' as const,
                status: 'ACTIVE' as const,
            })),
        );
        await database.connection.insert(petMemberships).values({
            id: randomUUID(),
            petId,
            accountId: collaborator.id,
            role: 'COLLABORATOR',
            status: 'ACTIVE',
        });
    });

    afterEach(async () => {
        for (const id of [petId, otherPetId]) {
            await database.connection
                .delete(healthWeightRecords)
                .where(eq(healthWeightRecords.petId, id));
            await database.connection.delete(petMemberships).where(eq(petMemberships.petId, id));
            await database.connection.delete(pets).where(eq(pets.id, id));
        }
    });

    async function createRecord(
        id: string = petId,
        recorder: AccountFixture = owner,
    ): Promise<string> {
        const response = await request(application.getHttpServer())
            .post(`/pets/${id}/health/weight-records`)
            .set('Authorization', `Bearer ${recorder.token}`)
            .send({ weightKg: '12', measuredDate: '2020-01-01' })
            .expect(201);

        return (response.body as { id: string }).id;
    }

    function path(recordId: string, id: string = petId): string {
        return `/pets/${id}/health/weight-records/${recordId}`;
    }

    it('allows a different collaborator to correct partial and combined values and delete', async () => {
        const recordId = await createRecord();
        const first = await request(application.getHttpServer())
            .patch(path(recordId))
            .set('Authorization', `Bearer ${collaborator.token}`)
            .send({ weightKg: '0013.5000' })
            .expect(200);

        expect(first.body).toEqual({
            id: recordId,
            petId,
            weightKg: '13.5',
            measuredDate: '2020-01-01',
            recordedByAccountId: owner.id,
        });
        const second = await request(application.getHttpServer())
            .patch(path(recordId))
            .set('Authorization', `Bearer ${owner.token}`)
            .send({ weightKg: '14', measuredDate: '2020-01-02' })
            .expect(200);

        expect(second.body).toMatchObject({
            weightKg: '14',
            measuredDate: '2020-01-02',
            recordedByAccountId: owner.id,
        });
        await request(application.getHttpServer())
            .delete(path(recordId))
            .set('Authorization', `Bearer ${collaborator.token}`)
            .expect(204);
        const history = await request(application.getHttpServer())
            .get(`/pets/${petId}/health/weight-records`)
            .set('Authorization', `Bearer ${owner.token}`)
            .expect(200);

        expect(history.body).toMatchObject({ items: [] });
        const again = await request(application.getHttpServer())
            .delete(path(recordId))
            .set('Authorization', `Bearer ${owner.token}`)
            .expect(404);

        expect(again.body).toMatchObject({
            code: 'WEIGHT_RECORD_NOT_FOUND',
            message: 'Weight record was not found',
        });
    });

    it('lets an owner correct and delete a collaborator-authored record', async () => {
        const recordId = await createRecord(petId, collaborator);
        const response = await request(application.getHttpServer())
            .patch(path(recordId))
            .set('Authorization', `Bearer ${owner.token}`)
            .send({ measuredDate: '2020-01-02' })
            .expect(200);

        expect(response.body).toMatchObject({
            measuredDate: '2020-01-02',
            recordedByAccountId: collaborator.id,
        });
        await request(application.getHttpServer())
            .delete(path(recordId))
            .set('Authorization', `Bearer ${owner.token}`)
            .expect(204);
    });

    it('validates structure, values, UUIDs and authentication', async () => {
        const recordId = await createRecord();
        const authorized = (method: 'patch' | 'delete', url: string) =>
            request(application.getHttpServer())
                [method](url)
                .set('Authorization', `Bearer ${owner.token}`);

        for (const body of [
            {},
            { weightKg: 1 },
            { measuredDate: null },
            { weightKg: '1', extra: true },
        ]) {
            const response = await authorized('patch', path(recordId)).send(body).expect(400);

            expect(response.body).toMatchObject({ code: 'INVALID_REQUEST' });
        }

        const weight = await authorized('patch', path(recordId))
            .send({ weightKg: '0', measuredDate: '9999-12-31' })
            .expect(400);

        expect(weight.body).toMatchObject({ code: 'INVALID_WEIGHT' });
        const date = await authorized('patch', path(recordId))
            .send({ measuredDate: '9999-12-31' })
            .expect(400);

        expect(date.body).toMatchObject({ code: 'INVALID_MEASURED_DATE' });

        for (const response of [
            await authorized('patch', path('bad')).send({ weightKg: '1' }).expect(400),
            await authorized('delete', path('bad')).expect(400),
            await authorized('delete', path(recordId)).send({ extra: true }).expect(400),
        ]) {
            expect(response.body).toMatchObject({ code: 'INVALID_REQUEST' });
        }

        await request(application.getHttpServer())
            .patch(path(recordId))
            .send({ weightKg: '1' })
            .expect(401);
        await request(application.getHttpServer()).delete(path(recordId)).expect(401);
        await authorized('delete', path(recordId)).send({}).expect(204);
    });

    it('checks pet access first and confines records to their pet', async () => {
        const recordId = await createRecord(otherPetId);

        for (const method of ['patch', 'delete'] as const) {
            const outsiderResponse = await request(application.getHttpServer())
                [method](path(recordId))
                .set('Authorization', `Bearer ${outsider.token}`)
                .send(method === 'patch' ? { weightKg: '1' } : undefined)
                .expect(404);

            expect(outsiderResponse.body).toMatchObject({ code: 'PET_NOT_FOUND' });
            const crossPetResponse = await request(application.getHttpServer())
                [method](path(recordId))
                .set('Authorization', `Bearer ${owner.token}`)
                .send(method === 'patch' ? { weightKg: '1' } : undefined)
                .expect(404);

            expect(crossPetResponse.body).toMatchObject({
                code: 'WEIGHT_RECORD_NOT_FOUND',
            });
        }

        await database.connection
            .update(pets)
            .set({ status: 'ARCHIVED' })
            .where(eq(pets.id, petId));
        const archived = await request(application.getHttpServer())
            .delete(path(recordId))
            .set('Authorization', `Bearer ${owner.token}`)
            .expect(404);

        expect(archived.body).toMatchObject({ code: 'PET_NOT_FOUND' });
    });
});
