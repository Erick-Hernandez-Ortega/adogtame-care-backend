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

describe('POST /pets/:petId/care/routines (e2e)', () => {
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
                type: 'FEEDING',
                title: 'Breakfast',
                instructions: 'One portion',
                frequency: {
                    period: 'DAILY',
                    timesPerPeriod: 1,
                    suggestedTimes: ['08:00'],
                    weekdays: [],
                },
                timezone: 'UTC',
                recordedByAccountId: account.id,
            });
            expect((await rows())[0]).toMatchObject({
                id: result.id,
                title: 'Breakfast',
                timezone: 'UTC',
                recordedByAccountId: account.id,
            });
        },
    );

    it('supports every type, Unicode limits, weekly suggestions, nulls and independent duplicates', async () => {
        for (const type of ['FEEDING', 'WALK', 'HYGIENE', 'OTHER']) {
            const response = await post()
                .send({
                    ...body(),
                    type,
                    title: '🐕'.repeat(255),
                    instructions: '🐕'.repeat(2000),
                    frequency: {
                        period: 'WEEKLY',
                        timesPerPeriod: 3,
                        suggestedTimes: ['23:59', '00:00', '00:01'],
                        weekdays: ['MONDAY', 'SUNDAY'],
                    },
                    timezone: 'America/Mexico_City',
                })
                .expect(201);

            expect(response.body).toMatchObject({
                type,
                timezone: 'America/Mexico_City',
                frequency: { timesPerPeriod: 3, weekdays: ['MONDAY', 'SUNDAY'] },
            });
        }

        const identifiers: string[] = [];

        for (const optionalFields of [{}, { instructions: null }]) {
            const response = await post()
                .send({
                    type: 'WALK',
                    title: 'Walk',
                    frequency: {
                        period: 'DAILY',
                        timesPerPeriod: Number.MAX_SAFE_INTEGER,
                        suggestedTimes: null,
                        weekdays: null,
                    },
                    timezone: 'UTC',
                    ...optionalFields,
                })
                .expect(201);

            expect(response.body).toMatchObject({
                instructions: null,
                frequency: {
                    timesPerPeriod: Number.MAX_SAFE_INTEGER,
                    suggestedTimes: [],
                    weekdays: [],
                },
            });
            identifiers.push((response.body as { id: string }).id);
        }

        expect(new Set(identifiers).size).toBe(2);
        expect(await rows()).toHaveLength(6);
    });

    it.each([
        { suggestedTimes: ['08:00', '08:00'] },
        { weekdays: ['MONDAY', 'MONDAY'] },
        {
            suggestedTimes: Array.from(
                { length: 25 },
                (_, minute: number): string => `08:${String(minute).padStart(2, '0')}`,
            ),
        },
        {
            weekdays: [
                'MONDAY',
                'TUESDAY',
                'WEDNESDAY',
                'THURSDAY',
                'FRIDAY',
                'SATURDAY',
                'SUNDAY',
                'MONDAY',
            ],
        },
    ])('rejects excessive or duplicate frequency suggestions %j', async (suggestions) => {
        const response = await post()
            .send({ ...body(), frequency: { period: 'WEEKLY', timesPerPeriod: 1, ...suggestions } })
            .expect(400);

        expect(response.body).toMatchObject({ code: 'INVALID_ROUTINE_FREQUENCY' });
        expect(await rows()).toHaveLength(0);
    });

    it.each([
        [{ type: 'feeding' }, 'INVALID_ROUTINE_TYPE'],
        [{ title: ' ' }, 'INVALID_ROUTINE_TITLE'],
        [{ title: '🐕'.repeat(256) }, 'INVALID_ROUTINE_TITLE'],
        [{ instructions: '' }, 'INVALID_ROUTINE_INSTRUCTIONS'],
        [{ instructions: '🐕'.repeat(2001) }, 'INVALID_ROUTINE_INSTRUCTIONS'],
        [{ frequency: { period: 'MONTHLY', timesPerPeriod: 1 } }, 'INVALID_ROUTINE_FREQUENCY'],
        [{ frequency: { period: 'DAILY', timesPerPeriod: 0 } }, 'INVALID_ROUTINE_FREQUENCY'],
        [{ frequency: { period: 'DAILY', timesPerPeriod: 1.5 } }, 'INVALID_ROUTINE_FREQUENCY'],
        [
            { frequency: { period: 'DAILY', timesPerPeriod: 1, suggestedTimes: ['8:00'] } },
            'INVALID_ROUTINE_FREQUENCY',
        ],
        [
            { frequency: { period: 'DAILY', timesPerPeriod: 1, weekdays: ['MONDAY'] } },
            'INVALID_ROUTINE_FREQUENCY',
        ],
        [
            { frequency: { period: 'WEEKLY', timesPerPeriod: 1, weekdays: ['Monday'] } },
            'INVALID_ROUTINE_FREQUENCY',
        ],
        [{ timezone: 'Mars/Olympus' }, 'INVALID_ROUTINE_TIMEZONE'],
        [{ timezone: '+01:00' }, 'INVALID_ROUTINE_TIMEZONE'],
    ])('maps semantic errors without inserting', async (overrides, code) => {
        expect(
            (
                await post()
                    .send({ ...body(), ...overrides })
                    .expect(400)
            ).body,
        ).toMatchObject({ code });
        expect(await rows()).toHaveLength(0);
    });

    it('rejects missing fields, wrong types, and unknown fields at both object levels', async () => {
        const payloads: (object | null)[] = [
            {},
            [],
            null,
            { ...body(), type: null },
            { ...body(), title: 1 },
            { ...body(), instructions: [] },
            { ...body(), frequency: null },
            { ...body(), frequency: [] },
            { ...body(), frequency: { period: 'DAILY' } },
            { ...body(), frequency: { period: 'DAILY', timesPerPeriod: '1' } },
            { ...body(), frequency: { period: 'DAILY', timesPerPeriod: 1, suggestedTimes: [1] } },
            { ...body(), frequency: { period: 'DAILY', timesPerPeriod: 1, weekdays: 'MONDAY' } },
            { ...body(), frequency: { period: 'DAILY', timesPerPeriod: 1, cron: '*' } },
            { ...body(), timezone: null },
            ...[
                'id',
                'petId',
                'recordedByAccountId',
                'authenticatedAccountId',
                'createdAt',
                'updatedAt',
                'status',
                'reminder',
            ].map((field: string) => ({ ...body(), [field]: 'unexpected' })),
        ];

        for (const field of ['type', 'title', 'frequency', 'timezone']) {
            const payload: Record<string, unknown> = { ...body() };

            delete payload[field];
            payloads.push(payload);
        }

        for (const payload of payloads) {
            expect(
                (
                    await post()
                        .send(payload === null ? 'null' : payload)
                        .expect(400)
                ).body,
            ).toMatchObject({ code: 'INVALID_REQUEST' });
        }

        expect((await post().expect(400)).body).toMatchObject({ code: 'INVALID_REQUEST' });
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

    it('validates routine values before checking transactional Pet access', async () => {
        expect(
            (
                await post(outsider)
                    .send({ ...body(), title: '' })
                    .expect(400)
            ).body,
        ).toMatchObject({
            code: 'INVALID_ROUTINE_TITLE',
        });
        expect(await rows()).toHaveLength(0);
    });
});
