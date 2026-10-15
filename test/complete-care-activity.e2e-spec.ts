import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import type { Test as HttpTest } from 'supertest';
import { AppModule } from '../src/app.module';
import {
    careRoutines,
    careActivities,
} from '../src/care/infrastructure/persistence/drizzle/care.schema';
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

describe('POST /pets/:petId/care/routines (e2e)', () => {
    let application: INestApplication<App>;
    let database: DatabaseService;
    let owner: AccountFixture;
    let collaborator: AccountFixture;
    let outsider: AccountFixture;
    let petId: string;
    let routineId: string;
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
            name: 'Care routine pet',
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
        routineId = randomUUID();
        await database.connection.insert(careRoutines).values({
            id: routineId,
            petId,
            type: 'FEEDING',
            title: 'Breakfast',
            frequencyPeriod: 'DAILY',
            timesPerPeriod: 1,
            timezone: 'UTC',
            recordedByAccountId: owner.id,
        });
    });

    afterEach(async () => {
        await database.connection.delete(careActivities).where(eq(careActivities.petId, petId));
        await database.connection.delete(careRoutines).where(eq(careRoutines.petId, petId));
        await database.connection.delete(petMemberships).where(eq(petMemberships.petId, petId));
        await database.connection.delete(pets).where(eq(pets.id, petId));
    });

    function path(id: string = petId, targetRoutineId: string = routineId): string {
        return `/pets/${id}/care/routines/${targetRoutineId}/activities`;
    }

    function body() {
        return { completedAt: '2020-01-01T01:00:00Z', timezone: 'Etc/UTC', notes: '  Done  ' };
    }

    function post(account: AccountFixture = owner, target: string = path()): HttpTest {
        return request(application.getHttpServer())
            .post(target)
            .set('Authorization', `Bearer ${account.token}`);
    }

    async function rows() {
        return database.connection
            .select()
            .from(careActivities)
            .where(eq(careActivities.petId, petId));
    }

    it.each(['owner', 'collaborator'] as const)(
        'records completion for %s regardless of routine authorship',
        async (role: 'owner' | 'collaborator') => {
            const account: AccountFixture = role === 'owner' ? owner : collaborator;
            const response = await post(account).send(body()).expect(201);
            const result = response.body as { id: string };

            expect(response.body).toEqual({
                id: result.id,
                petId,
                routineId,
                completedAt: '2020-01-01T01:00:00.000Z',
                completedBy: account.id,
                timezone: 'UTC',
                notes: 'Done',
            });
            expect((await rows())[0]).toMatchObject({
                id: result.id,
                completedBy: account.id,
                notes: 'Done',
            });
        },
    );

    it('accepts optional notes and independent duplicates without changing routine timezone', async () => {
        const identifiers: string[] = [];

        for (const notes of [undefined, null, '🐕'.repeat(2000)]) {
            const response = await post()
                .send({ ...body(), notes, timezone: 'America/Mexico_City' })
                .expect(201);

            expect(response.body).toMatchObject({
                notes: notes ?? null,
                timezone: 'America/Mexico_City',
            });
            identifiers.push((response.body as { id: string }).id);
        }

        expect(new Set(identifiers).size).toBe(3);
        expect(await rows()).toHaveLength(3);
        expect(
            (
                await database.connection
                    .select()
                    .from(careRoutines)
                    .where(eq(careRoutines.id, routineId))
            )[0]?.timezone,
        ).toBe('UTC');
    });

    it.each([
        [{ completedAt: '9999-01-01T00:00:00Z' }, 'INVALID_ACTIVITY_COMPLETED_AT'],
        [{ completedAt: '2020-02-30T00:00:00Z' }, 'INVALID_ACTIVITY_COMPLETED_AT'],
        [{ completedAt: '2020-01-01T00:00:00-06:00' }, 'INVALID_ACTIVITY_COMPLETED_AT'],
        [{ timezone: '+01:00' }, 'INVALID_ACTIVITY_TIMEZONE'],
        [{ notes: ' ' }, 'INVALID_ACTIVITY_NOTES'],
        [{ notes: '🐕'.repeat(2001) }, 'INVALID_ACTIVITY_NOTES'],
    ])('rejects invalid semantic values', async (overrides, code) => {
        expect(
            (
                await post()
                    .send({ ...body(), ...overrides })
                    .expect(400)
            ).body,
        ).toMatchObject({ code });
        expect(await rows()).toHaveLength(0);
    });

    it('rejects missing fields, invalid structures and client supplied authorship', async () => {
        for (const payload of [
            {},
            [],
            { completedAt: body().completedAt },
            { timezone: 'UTC' },
            { ...body(), completedAt: null },
            { ...body(), timezone: 1 },
            { ...body(), notes: [] },
            ...[
                'id',
                'petId',
                'routineId',
                'completedBy',
                'recordedByAccountId',
                'localDay',
                'createdAt',
            ].map((field: string) => ({ ...body(), [field]: 'unexpected' })),
        ]) {
            expect((await post().send(payload).expect(400)).body).toMatchObject({
                code: 'INVALID_REQUEST',
            });
        }

        expect((await post().expect(400)).body).toMatchObject({ code: 'INVALID_REQUEST' });
        expect(await rows()).toHaveLength(0);
    });

    it.each(['bad', '00000000-0000-0000-0000-000000000000'])(
        'rejects invalid routine UUID %s',
        async (identifier: string) => {
            expect(
                (await post(owner, path(petId, identifier)).send(body()).expect(400)).body,
            ).toMatchObject({ code: 'INVALID_REQUEST' });
        },
    );

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
        '?reason=Diabetes',
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

    it('validates activity values before transactional access', async () => {
        expect(
            (
                await post(outsider)
                    .send({ ...body(), notes: '' })
                    .expect(400)
            ).body,
        ).toMatchObject({ code: 'INVALID_ACTIVITY_NOTES' });
    });

    it('hides missing or wrong-pet routines after pet authorization', async () => {
        const otherPetId: string = randomUUID();

        await database.connection.insert(pets).values({
            id: otherPetId,
            name: 'Other',
            species: 'CAT',
            breedName: 'Mixed',
            breedKind: 'CUSTOM',
            sex: 'UNKNOWN',
            birthDate: '2020-01-01',
            birthDateAccuracy: 'EXACT',
            status: 'ACTIVE',
        });
        const otherRoutineId: string = randomUUID();

        try {
            await database.connection.insert(careRoutines).values({
                id: otherRoutineId,
                petId: otherPetId,
                type: 'OTHER',
                title: 'Other',
                frequencyPeriod: 'DAILY',
                timesPerPeriod: 1,
                timezone: 'UTC',
                recordedByAccountId: owner.id,
            });

            for (const target of [randomUUID(), otherRoutineId]) {
                expect(
                    (await post(owner, path(petId, target)).send(body()).expect(404)).body,
                ).toMatchObject({ code: 'CARE_ROUTINE_NOT_FOUND' });
                expect(
                    (await post(outsider, path(petId, target)).send(body()).expect(404)).body,
                ).toMatchObject({ code: 'PET_NOT_FOUND' });
            }
        } finally {
            await database.connection
                .delete(careRoutines)
                .where(eq(careRoutines.petId, otherPetId));
            await database.connection.delete(pets).where(eq(pets.id, otherPetId));
        }
    });
});
