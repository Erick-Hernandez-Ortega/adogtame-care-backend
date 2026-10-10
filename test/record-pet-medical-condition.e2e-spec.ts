import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { HEALTH_CLOCK } from '../src/health/application/time/clock';
import type { Test as HttpTest } from 'supertest';
import { AppModule } from '../src/app.module';
import { healthPetMedicalConditions } from '../src/health/infrastructure/persistence/drizzle/health.schema';
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

describe('POST /pets/:petId/health/medical-conditions (e2e)', () => {
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
        })
            .overrideProvider(HEALTH_CLOCK)
            .useValue({ now: (): Date => new Date('2026-03-13T18:30:00-06:00') })
            .compile();

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
            name: 'Medical condition pet',
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
            .delete(healthPetMedicalConditions)
            .where(eq(healthPetMedicalConditions.petId, petId));
        await database.connection.delete(petMemberships).where(eq(petMemberships.petId, petId));
        await database.connection.delete(pets).where(eq(pets.id, petId));
    });

    function path(id: string = petId): string {
        return `/pets/${id}/health/medical-conditions`;
    }

    function body() {
        return {
            name: '  Epilepsy  ',
            diagnosedDate: '2026-03-14',
            notes: '  Recurring seizures monitored by veterinarian.  ',
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
            .from(healthPetMedicalConditions)
            .where(eq(healthPetMedicalConditions.petId, petId));
    }

    it.each(['owner', 'collaborator'] as const)(
        'returns the exact normalized response for %s',
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
                name: 'Epilepsy',
                status: 'ACTIVE',
                diagnosedDate: '2026-03-14',
                notes: 'Recurring seizures monitored by veterinarian.',
                recordedByAccountId: account.id,
            });
        },
    );

    it('accepts absent and null optional fields, Unicode limits and duplicate names', async () => {
        const payloads = [
            { name: 'Diabetes' },
            { name: 'Diabetes', diagnosedDate: null, notes: null },
            { name: '🐕'.repeat(255), notes: '🐕'.repeat(2000) },
        ];
        const identifiers: string[] = [];

        for (const payload of payloads) {
            const response = await post().send(payload).expect(201);

            expect(response.body).toEqual({
                id: expect.any(String) as string,
                petId,
                ...payload,
                status: 'ACTIVE',
                diagnosedDate: null,
                notes: 'notes' in payload ? payload.notes : null,
                recordedByAccountId: owner.id,
            });
            identifiers.push((response.body as { id: string }).id);
        }

        expect(new Set(identifiers).size).toBe(3);
        expect(await rows()).toHaveLength(3);
    });

    it.each(['2024-02-29', '2026-03-14'])(
        'accepts past and today UTC date %s',
        async (diagnosedDate: string) => {
            const response = await post().send({ name: 'Arthritis', diagnosedDate }).expect(201);

            expect(response.body).toMatchObject({ diagnosedDate });
            expect((await rows())[0]?.diagnosedDate).toBe(diagnosedDate);
        },
    );

    it.each([
        [{ name: '' }, 'INVALID_MEDICAL_CONDITION_NAME'],
        [{ name: ' ' }, 'INVALID_MEDICAL_CONDITION_NAME'],
        [{ name: '🐕'.repeat(256) }, 'INVALID_MEDICAL_CONDITION_NAME'],
        [{ notes: '' }, 'INVALID_MEDICAL_CONDITION_NOTES'],
        [{ notes: ' \t\n' }, 'INVALID_MEDICAL_CONDITION_NOTES'],
        [{ notes: '🐕'.repeat(2001) }, 'INVALID_MEDICAL_CONDITION_NOTES'],
        [{ diagnosedDate: '' }, 'INVALID_MEDICAL_CONDITION_DIAGNOSED_DATE'],
        [{ diagnosedDate: '2026' }, 'INVALID_MEDICAL_CONDITION_DIAGNOSED_DATE'],
        [{ diagnosedDate: '2026-03' }, 'INVALID_MEDICAL_CONDITION_DIAGNOSED_DATE'],
        [{ diagnosedDate: '2026-3-14' }, 'INVALID_MEDICAL_CONDITION_DIAGNOSED_DATE'],
        [{ diagnosedDate: '2026-02-29' }, 'INVALID_MEDICAL_CONDITION_DIAGNOSED_DATE'],
        [{ diagnosedDate: '2026-03-15' }, 'INVALID_MEDICAL_CONDITION_DIAGNOSED_DATE'],
    ])('maps semantic validation failures without inserting', async (overrides, code) => {
        const response = await post()
            .send({ ...body(), ...overrides })
            .expect(400);

        expect(response.body).toEqual({
            code,
            message: expect.any(String) as string,
        });
        expect(await rows()).toHaveLength(0);
    });

    it('rejects missing name, wrong types and additional fields', async () => {
        const payloads: unknown[] = [
            {},
            { notes: 'Context' },
            { ...body(), name: null },
            { ...body(), name: 1 },
            { ...body(), diagnosedDate: 1 },
            { ...body(), diagnosedDate: [] },
            { ...body(), notes: 1 },
            { ...body(), notes: [] },
            { ...body(), extra: true },
            { ...body(), petId },
            { ...body(), recordedByAccountId: owner.id },
            { ...body(), authenticatedAccountId: owner.id },
            { ...body(), id: randomUUID() },
            { ...body(), medicalConditionId: randomUUID() },
            { ...body(), createdAt: '2026-01-01' },
            { ...body(), updatedAt: '2026-01-01' },
            { ...body(), identifiedDate: '2026-01-01' },
            { ...body(), status: 'ACTIVE' },
            { ...body(), status: 'RESOLVED' },
            { ...body(), severity: 'MILD' },
            [],
            null,
        ];

        for (const payload of payloads) {
            const response = await post().send(payload).expect(400);

            expect(response.body).toEqual({
                code: 'INVALID_REQUEST',
                message: expect.any(String) as string,
            });
        }

        expect((await post().expect(400)).body).toMatchObject({
            code: 'INVALID_REQUEST',
        });
        expect(await rows()).toHaveLength(0);
    });

    it.each(['bad', '00000000-0000-0000-0000-000000000000'])(
        'rejects invalid or nil Pet UUID %s',
        async (identifier: string) => {
            expect(
                (await post(owner, path(identifier)).send(body()).expect(400)).body,
            ).toMatchObject({ code: 'INVALID_REQUEST' });
            expect(await rows()).toHaveLength(0);
        },
    );

    it.each([
        '?limit=1',
        '?status=ACTIVE',
        '?name=Diabetes',
        '?extra=',
        '?extra=1&extra=2',
        '?extra[nested]=value',
    ])('rejects unexpected query %s before checking access', async (query: string) => {
        expect(
            (
                await post(outsider, path() + query)
                    .send(body())
                    .expect(400)
            ).body,
        ).toEqual({
            code: 'INVALID_REQUEST',
            message: 'Request query is invalid',
        });
        expect(await rows()).toHaveLength(0);
    });

    it('requires authentication before path, body and query validation, including parser failures', async () => {
        for (const authorization of [undefined, 'Bearer invalid-token']) {
            for (const isMalformed of [false, true]) {
                const action: HttpTest = request(application.getHttpServer()).post(
                    path('bad') + '?extra=1',
                );

                if (authorization !== undefined) {
                    action.set('Authorization', authorization);
                }

                if (isMalformed) {
                    action.set('Content-Type', 'application/json').send('{');
                } else {
                    action.send({ status: 'RESOLVED' });
                }

                expect((await action.expect(401)).body).toMatchObject({
                    code: 'UNAUTHENTICATED',
                });
            }
        }

        expect(await rows()).toHaveLength(0);
    });

    it.each(['{', 'null', '42', '"text"'])(
        'normalizes authenticated JSON parser failure %s',
        async (payload: string) => {
            expect(
                (await post().set('Content-Type', 'application/json').send(payload).expect(400))
                    .body,
            ).toEqual({
                code: 'INVALID_REQUEST',
                message: 'Request body is invalid',
            });
            expect(await rows()).toHaveLength(0);
        },
    );

    it('hides missing, archived, inactive and unjoined pets without inserting', async () => {
        expect((await post(outsider).send(body()).expect(404)).body).toEqual({
            code: 'PET_NOT_FOUND',
            message: 'Pet was not found',
        });
        await database.connection
            .update(petMemberships)
            .set({ status: 'INACTIVE' })
            .where(eq(petMemberships.id, collaboratorMembershipId));
        expect((await post(collaborator).send(body()).expect(404)).body).toMatchObject({
            code: 'PET_NOT_FOUND',
        });
        await database.connection
            .update(pets)
            .set({ status: 'ARCHIVED' })
            .where(eq(pets.id, petId));
        expect((await post().send(body()).expect(404)).body).toMatchObject({
            code: 'PET_NOT_FOUND',
        });
        expect((await post(owner, path(randomUUID())).send(body()).expect(404)).body).toMatchObject(
            { code: 'PET_NOT_FOUND' },
        );
        expect(await rows()).toHaveLength(0);
    });

    it('validates clinical values before checking transactional Pet access', async () => {
        expect((await post(outsider).send({ name: '' }).expect(400)).body).toMatchObject({
            code: 'INVALID_MEDICAL_CONDITION_NAME',
        });
        expect(await rows()).toHaveLength(0);
    });
});
