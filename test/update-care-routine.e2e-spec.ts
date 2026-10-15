import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import type { Test as HttpTest } from 'supertest';
import { AppModule } from '../src/app.module';
import { careRoutines } from '../src/care/infrastructure/persistence/drizzle/care.schema';
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

describe('PATCH /pets/:petId/care/routines/:routineId (e2e)', () => {
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
    });

    afterEach(async () => {
        await database.connection.delete(careRoutines).where(eq(careRoutines.petId, petId));
        await database.connection.delete(petMemberships).where(eq(petMemberships.petId, petId));
        await database.connection.delete(pets).where(eq(pets.id, petId));
    });

    function path(id: string = petId): string {
        return `/pets/${id}/care/routines`;
    }

    function body() {
        return {
            type: 'FEEDING',
            title: '  Breakfast  ',
            instructions: '  One portion  ',
            frequency: { period: 'DAILY', timesPerPeriod: 1, suggestedTimes: ['08:00'] },
            timezone: 'Etc/UTC',
        };
    }

    function post(account: AccountFixture = owner, target: string = path()): HttpTest {
        return request(application.getHttpServer())
            .post(target)
            .set('Authorization', `Bearer ${account.token}`);
    }

    async function rows() {
        return database.connection.select().from(careRoutines).where(eq(careRoutines.petId, petId));
    }

    async function create(): Promise<Record<string, unknown> & { id: string }> {
        const response = await post().send(body()).expect(201);

        return response.body as Record<string, unknown> & { id: string };
    }

    function patch(
        routineId: string,
        account: AccountFixture = collaborator,
        targetPetId: string = petId,
    ): HttpTest {
        return request(application.getHttpServer())
            .patch(`${path(targetPetId)}/${routineId}`)
            .set('Authorization', `Bearer ${account.token}`);
    }

    it.each(['owner', 'collaborator'] as const)(
        'returns an exact partial correction for %s and exposes it in List',
        async (role) => {
            const original = await create();
            const account: AccountFixture = role === 'owner' ? owner : collaborator;
            const response = await patch(original.id, account)
                .send({ title: ' Evening meal ', instructions: null, timezone: 'America/New_York' })
                .expect(200);

            expect(response.body).toEqual({
                ...original,
                title: 'Evening meal',
                instructions: null,
                timezone: 'America/New_York',
            });
            const list = await request(application.getHttpServer())
                .get(path())
                .set('Authorization', `Bearer ${account.token}`)
                .expect(200);
            const { petId: omittedPetId, ...item } = response.body as Record<string, unknown>;

            expect(omittedPetId).toBe(petId);
            expect(list.body).toEqual({ nextCursor: null, items: [item] });
            const before = await rows();

            await patch(original.id, account).send({ title: ' Evening meal ' }).expect(200);
            expect(await rows()).toEqual(before);
        },
    );

    it('replaces frequency completely and accepts Unicode limits and canonical timezone', async () => {
        const original = await create();
        const response = await patch(original.id)
            .send({
                type: 'OTHER',
                title: '🐕'.repeat(255),
                instructions: '🐕'.repeat(2000),
                frequency: {
                    period: 'WEEKLY',
                    timesPerPeriod: 3,
                    suggestedTimes: ['23:59', '00:00', '00:01'],
                    weekdays: ['MONDAY'],
                },
                timezone: 'Etc/UTC',
            })
            .expect(200);

        expect(response.body).toMatchObject({
            type: 'OTHER',
            timezone: 'UTC',
            frequency: { suggestedTimes: ['23:59', '00:00', '00:01'], weekdays: ['MONDAY'] },
            recordedByAccountId: owner.id,
        });
        const replacement = await patch(original.id)
            .send({ frequency: { period: 'DAILY', timesPerPeriod: 1 } })
            .expect(200);

        expect((replacement.body as { frequency: unknown }).frequency).toEqual({
            period: 'DAILY',
            timesPerPeriod: 1,
            suggestedTimes: [],
            weekdays: [],
        });
    });

    it.each([
        {},
        { unknown: true },
        { recordedByAccountId: 'anything' },
        { type: null },
        { title: null },
        { frequency: null },
        { timezone: null },
        { title: 1 },
        { frequency: {} },
        { frequency: { period: 'DAILY', timesPerPeriod: 1, extra: true } },
        { frequency: { period: 'DAILY', timesPerPeriod: '1' } },
    ])('rejects invalid structures %j', async (fields) => {
        const routine = await create();
        const response = await patch(routine.id).send(fields).expect(400);

        expect(response.body).toMatchObject({ code: 'INVALID_REQUEST' });
    });

    it.each([
        [{ type: 'MEDICATION' }, 'INVALID_ROUTINE_TYPE'],
        [{ title: ' ' }, 'INVALID_ROUTINE_TITLE'],
        [{ title: '🐕'.repeat(256) }, 'INVALID_ROUTINE_TITLE'],
        [{ instructions: '' }, 'INVALID_ROUTINE_INSTRUCTIONS'],
        [{ instructions: '🐕'.repeat(2001) }, 'INVALID_ROUTINE_INSTRUCTIONS'],
        [{ frequency: { period: 'DAILY', timesPerPeriod: 0 } }, 'INVALID_ROUTINE_FREQUENCY'],
        [
            { frequency: { period: 'DAILY', timesPerPeriod: 1, weekdays: ['MONDAY'] } },
            'INVALID_ROUTINE_FREQUENCY',
        ],
        [{ timezone: '+01:00' }, 'INVALID_ROUTINE_TIMEZONE'],
    ])('returns domain errors after target resolution %j', async (fields, code) => {
        const routine = await create();
        const response = await patch(routine.id).send(fields).expect(400);

        expect(response.body).toMatchObject({ code });
    });

    it('checks pet access before routine existence and domain values, including inactive authors and archives', async () => {
        const routine = await create();

        for (const target of [routine.id, randomUUID()]) {
            const denied = await patch(target, outsider).send({ title: ' ' }).expect(404);

            expect(denied.body).toMatchObject({ code: 'PET_NOT_FOUND' });
        }

        const absent = await patch(randomUUID()).send({ title: ' ' }).expect(404);

        expect(absent.body).toMatchObject({ code: 'CARE_ROUTINE_NOT_FOUND' });
        await database.connection
            .update(petMemberships)
            .set({ status: 'INACTIVE' })
            .where(eq(petMemberships.id, collaboratorMembershipId));
        expect((await patch(routine.id).send({ title: 'New' }).expect(404)).body).toMatchObject({
            code: 'PET_NOT_FOUND',
        });
        await database.connection
            .update(pets)
            .set({ status: 'ARCHIVED' })
            .where(eq(pets.id, petId));
        expect(
            (await patch(routine.id, owner).send({ title: 'New' }).expect(404)).body,
        ).toMatchObject({ code: 'PET_NOT_FOUND' });
    });

    it('rejects wrong-pet routine IDs and strict paths and queries', async () => {
        const routine = await create();
        const other = await database.connection
            .insert(pets)
            .values({
                id: randomUUID(),
                name: 'Other',
                species: 'CAT',
                breedName: 'Mixed',
                breedKind: 'CUSTOM',
                sex: 'UNKNOWN',
                birthDate: '2020-01-01',
                birthDateAccuracy: 'EXACT',
                status: 'ACTIVE',
            })
            .returning();
        const otherPetId: string = other[0].id;

        try {
            await database.connection.insert(petMemberships).values({
                id: randomUUID(),
                petId: otherPetId,
                accountId: owner.id,
                role: 'OWNER',
                status: 'ACTIVE',
            });
            expect(
                (await patch(routine.id, owner, otherPetId).send({ title: 'New' }).expect(404))
                    .body,
            ).toMatchObject({ code: 'CARE_ROUTINE_NOT_FOUND' });
        } finally {
            await database.connection
                .delete(petMemberships)
                .where(eq(petMemberships.petId, otherPetId));
            await database.connection.delete(pets).where(eq(pets.id, otherPetId));
        }

        for (const invalid of ['bad', '00000000-0000-0000-0000-000000000000']) {
            await patch(invalid).send({ title: 'New' }).expect(400);
            await patch(routine.id, owner, invalid).send({ title: 'New' }).expect(400);
        }

        await patch(routine.id).query({ extra: true }).send({ title: 'New' }).expect(400);
    });

    it.each(['{', 'null', '1', '"value"'])(
        'authenticates before JSON parser failure %s',
        async (payload: string) => {
            for (const token of [undefined, 'invalid', owner.token]) {
                const operation = request(application.getHttpServer())
                    .patch(`${path()}/${randomUUID()}`)
                    .set('Content-Type', 'application/json');

                if (token !== undefined) {
                    operation.set('Authorization', `Bearer ${token}`);
                }

                const response = await operation
                    .send(payload)
                    .expect(token === owner.token ? 400 : 401);

                expect(response.body).toMatchObject({
                    code: token === owner.token ? 'INVALID_REQUEST' : 'UNAUTHENTICATED',
                });
            }
        },
    );

    it('authenticates before structural validation, including absent bodies', async () => {
        await request(application.getHttpServer())
            .patch(`${path('bad')}/bad`)
            .send({})
            .expect(401);
        await patch(randomUUID()).expect(400);
    });
});
