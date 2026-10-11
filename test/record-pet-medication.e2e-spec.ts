import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import type { Test as HttpTest } from 'supertest';
import { AppModule } from '../src/app.module';
import { healthPetMedications } from '../src/health/infrastructure/persistence/drizzle/health.schema';
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

describe('POST /pets/:petId/health/medications (e2e)', () => {
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
            name: 'Medication pet',
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
            .delete(healthPetMedications)
            .where(eq(healthPetMedications.petId, petId));
        await database.connection.delete(petMemberships).where(eq(petMemberships.petId, petId));
        await database.connection.delete(pets).where(eq(pets.id, petId));
    });

    function path(id: string = petId): string {
        return `/pets/${id}/health/medications`;
    }

    function body() {
        return {
            name: '  Amoxicillin  ',
            dosage: '  250 mg  ',
            frequency: '  Every 12 hours  ',
            startDate: '2099-10-10',
            plannedEndDate: '2099-10-17',
            notes: '  Give with food  ',
        };
    }

    function post(account: AccountFixture = owner, target: string = path()): HttpTest {
        return request(application.getHttpServer())
            .post(target)
            .set('Authorization', `Bearer ${account.token}`);
    }

    async function rows() {
        return database.connection
            .select()
            .from(healthPetMedications)
            .where(eq(healthPetMedications.petId, petId));
    }

    it.each(['owner', 'collaborator'] as const)(
        'returns the exact normalized 201 representation for %s',
        async (role: 'owner' | 'collaborator') => {
            const account: AccountFixture = role === 'owner' ? owner : collaborator;
            const response = await post(account).send(body()).expect(201);
            const result = response.body as { id: string };

            expect(result.id).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
            );
            expect(response.body).toEqual({
                id: result.id,
                petId,
                name: 'Amoxicillin',
                dosage: '250 mg',
                frequency: 'Every 12 hours',
                startDate: '2099-10-10',
                plannedEndDate: '2099-10-17',
                notes: 'Give with food',
                status: 'OPEN',
                endedDate: null,
                discontinuationReason: null,
                recordedByAccountId: account.id,
            });
        },
    );

    it('accepts omitted and null fields, Unicode boundaries and independently known dates', async () => {
        const payloads = [
            { name: 'Amoxicillin' },
            {
                name: 'Amoxicillin',
                dosage: null,
                frequency: null,
                startDate: null,
                plannedEndDate: null,
                notes: null,
            },
            {
                name: '🐕'.repeat(255),
                dosage: '🐕'.repeat(2000),
                frequency: '🐕'.repeat(2000),
                notes: '🐕'.repeat(2000),
            },
            { name: 'Amoxicillin', startDate: '2099-10-10' },
            { name: 'Amoxicillin', plannedEndDate: '2099-10-17' },
            { name: 'Amoxicillin', startDate: '2099-10-10', plannedEndDate: '2099-10-10' },
            { name: 'Amoxicillin', startDate: '0001-01-01', plannedEndDate: '9999-12-31' },
        ];

        for (const payload of payloads) {
            const response = await post().send(payload).expect(201);
            const result = response.body as { id: string };

            expect(response.body).toEqual({
                id: result.id,
                petId,
                dosage: null,
                frequency: null,
                startDate: null,
                plannedEndDate: null,
                notes: null,
                ...payload,
                status: 'OPEN',
                endedDate: null,
                discontinuationReason: null,
                recordedByAccountId: owner.id,
            });
        }
    });

    it('permits identical records with independent identities', async () => {
        const first = await post().send(body()).expect(201);
        const second = await post().send(body()).expect(201);

        expect((first.body as { id: string }).id).not.toBe((second.body as { id: string }).id);
        expect(await rows()).toHaveLength(2);
    });

    it.each([
        [{ name: '' }, 'INVALID_MEDICATION_NAME'],
        [{ name: '🐕'.repeat(256) }, 'INVALID_MEDICATION_NAME'],
        [{ dosage: ' ' }, 'INVALID_MEDICATION_DOSAGE'],
        [{ dosage: '🐕'.repeat(2001) }, 'INVALID_MEDICATION_DOSAGE'],
        [{ frequency: '\t\n' }, 'INVALID_MEDICATION_FREQUENCY'],
        [{ frequency: '🐕'.repeat(2001) }, 'INVALID_MEDICATION_FREQUENCY'],
        [{ startDate: '2026-02-29' }, 'INVALID_MEDICATION_START_DATE'],
        [{ startDate: '0000-01-01' }, 'INVALID_MEDICATION_START_DATE'],
        [{ startDate: '10000-01-01' }, 'INVALID_MEDICATION_START_DATE'],
        [{ startDate: '2026-10' }, 'INVALID_MEDICATION_START_DATE'],
        [{ startDate: '2099-10-10\n' }, 'INVALID_MEDICATION_START_DATE'],
        [{ plannedEndDate: '2026-04-31' }, 'INVALID_MEDICATION_PLANNED_END_DATE'],
        [{ plannedEndDate: '2099-10-09' }, 'INVALID_MEDICATION_PLANNED_END_DATE'],
        [{ notes: ' ' }, 'INVALID_MEDICATION_NOTES'],
        [{ notes: '🐕'.repeat(2001) }, 'INVALID_MEDICATION_NOTES'],
    ])(
        'rejects invalid semantic medication values after authorization',
        async (information, code: string) => {
            const response = await post()
                .send({ ...body(), ...information })
                .expect(400);

            expect(response.body).toMatchObject({ code });
            expect(await rows()).toHaveLength(0);
        },
    );

    it('requires a strict object body and rejects missing name, wrong types and unapproved fields', async () => {
        const payloads: unknown[] = [
            undefined,
            {},
            [],
            null,
            42,
            true,
            'text',
            { name: null },
            { name: 1 },
        ];

        for (const field of ['dosage', 'frequency', 'startDate', 'plannedEndDate', 'notes']) {
            payloads.push(
                { name: 'Amoxicillin', [field]: 1 },
                { name: 'Amoxicillin', [field]: [] },
                { name: 'Amoxicillin', [field]: {} },
            );
        }

        for (const field of [
            'id',
            'petId',
            'recordedByAccountId',
            'status',
            'medicalConditionId',
            'endDate',
            'extra',
        ]) {
            payloads.push({ name: 'Amoxicillin', [field]: 'not accepted' });
        }

        for (const payload of payloads) {
            const response = await post()
                .set('Content-Type', 'application/json')
                .send(payload === undefined ? undefined : JSON.stringify(payload))
                .expect(400);

            expect(response.body).toEqual({
                code: 'INVALID_REQUEST',
                message: 'Request body is invalid',
            });
        }

        expect(await rows()).toHaveLength(0);
    });

    it.each(['bad', '00000000-0000-0000-0000-000000000000'])(
        'rejects invalid or nil pet UUID %s before body validation',
        async (invalidId: string) => {
            const response = await post(owner, path(invalidId)).send({}).expect(400);

            expect(response.body).toEqual({
                code: 'INVALID_REQUEST',
                message: 'Pet id is invalid',
            });
        },
    );

    it.each(['?extra=true', '?limit=10', '?extra[a]=1'])(
        'rejects query %s before access or semantic validation',
        async (query: string) => {
            const response = await post(outsider, `${path()}${query}`)
                .send({ name: '' })
                .expect(400);

            expect(response.body).toEqual({
                code: 'INVALID_REQUEST',
                message: 'Request query is invalid',
            });
        },
    );

    it('validates body before query and access', async () => {
        const response = await post(outsider, `${path()}?extra=true`)
            .send({ name: null })
            .expect(400);

        expect(response.body).toEqual({
            code: 'INVALID_REQUEST',
            message: 'Request body is invalid',
        });
    });

    it.each(['{', 'null', '42', 'true', '"text"', '[]'])(
        'rejects malformed or nonobject JSON %s with INVALID_REQUEST when authenticated',
        async (payload: string) => {
            const response = await post()
                .set('Content-Type', 'application/json')
                .send(payload)
                .expect(400);

            expect(response.body).toEqual({
                code: 'INVALID_REQUEST',
                message: 'Request body is invalid',
            });
        },
    );

    it.each([undefined, 'Bearer invalid', 'Basic invalid'])(
        'requires authentication %s before invalid path, body, query and parser errors',
        async (authorization: string | undefined) => {
            for (const payload of [
                '{',
                'null',
                '42',
                'true',
                '"text"',
                '[]',
                '{}',
                '{"name":""}',
            ]) {
                const httpRequest = request(application.getHttpServer())
                    .post('/pets/bad/health/medications?extra=true')
                    .set('Content-Type', 'application/json');

                if (authorization !== undefined) {
                    httpRequest.set('Authorization', authorization);
                }

                const response = await httpRequest.send(payload).expect(401);

                expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED' });
            }
        },
    );

    it('hides inaccessible pets before validating semantic information', async () => {
        const invalid = { name: '', dosage: '', startDate: 'bad', notes: '' };
        const unjoined = await post(outsider).send(invalid).expect(404);
        const missing = await post(owner, path(randomUUID())).send(invalid).expect(404);

        expect(unjoined.body).toEqual({ code: 'PET_NOT_FOUND', message: 'Pet was not found' });
        expect(missing.body).toEqual(unjoined.body);
        await database.connection
            .update(petMemberships)
            .set({ status: 'INACTIVE' })
            .where(eq(petMemberships.id, collaboratorMembershipId));
        const inactive = await post(collaborator).send(invalid).expect(404);

        expect(inactive.body).toEqual(unjoined.body);
        await database.connection
            .update(pets)
            .set({ status: 'ARCHIVED' })
            .where(eq(pets.id, petId));
        const archived = await post().send(invalid).expect(404);

        expect(archived.body).toEqual(unjoined.body);
        expect(await rows()).toHaveLength(0);
    });
});
