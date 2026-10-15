import { configureSecurityHeaders } from '../src/infrastructure/http/configure-security-headers';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
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
    readonly id: string;
    readonly token: string;
}

describe('GET /pets/:petId/care/summary (e2e)', () => {
    let application: INestApplication<App>;
    let database: DatabaseService;
    let owner: AccountFixture;
    let collaborator: AccountFixture;
    let outsider: AccountFixture;
    let petId: string;
    let otherPetId: string;

    async function createAccount(): Promise<AccountFixture> {
        const email: string = `${randomUUID()}@example.com`;
        const password: string = 'a secure password';
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

    async function createPet(): Promise<string> {
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

        return (response.body as { id: string }).id;
    }

    beforeAll(async (): Promise<void> => {
        const fixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        application = fixture.createNestApplication();
        configureSecurityHeaders(application);
        await application.init();
        database = application.get(DatabaseService);
        owner = await createAccount();
        collaborator = await createAccount();
        outsider = await createAccount();
    });

    afterAll(async (): Promise<void> => {
        await database.connection
            .delete(accounts)
            .where(inArray(accounts.id, [owner.id, collaborator.id, outsider.id]));
        await application.close();
    });

    beforeEach(async (): Promise<void> => {
        petId = await createPet();
        otherPetId = await createPet();
        await database.connection.insert(petMemberships).values({
            id: randomUUID(),
            petId,
            accountId: collaborator.id,
            role: 'COLLABORATOR',
            status: 'ACTIVE',
        });
    });

    afterEach(async (): Promise<void> => {
        await database.connection
            .delete(careActivities)
            .where(inArray(careActivities.petId, [petId, otherPetId]));
        await database.connection
            .delete(careRoutines)
            .where(inArray(careRoutines.petId, [petId, otherPetId]));
        await database.connection
            .delete(petMemberships)
            .where(inArray(petMemberships.petId, [petId, otherPetId]));
        await database.connection.delete(pets).where(inArray(pets.id, [petId, otherPetId]));
    });

    function path(requestedPetId: string = petId): string {
        return `/pets/${requestedPetId}/care/summary`;
    }

    const dates = { from: '2026-03-08', to: '2026-03-08' };

    async function routine(period: string = 'DAILY'): Promise<string> {
        const response = await request(application.getHttpServer())
            .post(`/pets/${petId}/care/routines`)
            .set('Authorization', `Bearer ${owner.token}`)
            .send({
                type: 'WALK',
                title: 'Walk',
                frequency: { period, timesPerPeriod: 2 },
                timezone: 'UTC',
            })
            .expect(201);
        const id: string = (response.body as { id: string }).id;

        await database.connection
            .update(careRoutines)
            .set({ createdAt: new Date('2026-03-01T00:00:00Z') })
            .where(eq(careRoutines.id, id));

        return id;
    }

    it.each(['ACTIVE', 'ARCHIVED'] as const)(
        'returns exact summary for %s pets to owners and collaborators',
        async (status): Promise<void> => {
            const routineId: string = await routine();

            await request(application.getHttpServer())
                .post(`/pets/${petId}/care/routines/${routineId}/activities`)
                .set('Authorization', `Bearer ${collaborator.token}`)
                .send({ completedAt: '2026-03-09T03:59:59Z', timezone: 'America/New_York' })
                .expect(201);
            await database.connection.update(pets).set({ status }).where(eq(pets.id, petId));

            for (const account of [owner, collaborator]) {
                const response = await request(application.getHttpServer())
                    .get(path())
                    .query({ ...dates, routineId })
                    .set('Authorization', `Bearer ${account.token}`)
                    .expect(200);

                expect(response.body).toEqual({
                    nextCursor: null,
                    items: [
                        {
                            routineId,
                            timezone: 'UTC',
                            weeks: [],
                            days: [
                                { localDay: '2026-03-08', expected: 2, completed: 1, missed: 1 },
                            ],
                        },
                    ],
                });
            }
        },
    );

    it('returns whole overlapping ISO weeks, including completions outside the range', async (): Promise<void> => {
        const routineId: string = await routine('WEEKLY');

        await request(application.getHttpServer())
            .post(`/pets/${petId}/care/routines/${routineId}/activities`)
            .set('Authorization', `Bearer ${owner.token}`)
            .send({ completedAt: '2026-03-02T12:00:00Z', timezone: 'UTC' })
            .expect(201);
        const response = await request(application.getHttpServer())
            .get(path())
            .query({ ...dates, routineId })
            .set('Authorization', `Bearer ${owner.token}`)
            .expect(200);

        expect(response.body).toEqual({
            nextCursor: null,
            items: [
                {
                    routineId,
                    timezone: 'UTC',
                    days: [],
                    weeks: [{ weekStart: '2026-03-02', expected: 2, completed: 1, missed: 1 }],
                },
            ],
        });
    });

    it('keeps empty results distinct from hidden pet access, including filters', async (): Promise<void> => {
        const response = await request(application.getHttpServer())
            .get(path())
            .query({ ...dates, routineId: randomUUID() })
            .set('Authorization', `Bearer ${owner.token}`)
            .expect(200);

        expect(response.body).toEqual({ items: [], nextCursor: null });

        for (const requestedPetId of [petId, randomUUID()]) {
            const denied = await request(application.getHttpServer())
                .get(path(requestedPetId))
                .query(dates)
                .set('Authorization', `Bearer ${outsider.token}`)
                .expect(404);

            expect(denied.body).toEqual({ code: 'PET_NOT_FOUND', message: 'Pet was not found' });
        }

        await database.connection
            .update(petMemberships)
            .set({ status: 'INACTIVE' })
            .where(
                and(eq(petMemberships.petId, petId), eq(petMemberships.accountId, collaborator.id)),
            );
        await request(application.getHttpServer())
            .get(path())
            .query(dates)
            .set('Authorization', `Bearer ${collaborator.token}`)
            .expect(404);
    });

    it.each([
        '',
        'from=2026-03-01',
        'to=2026-03-01',
        'from=2026-02-29&to=2026-03-01',
        'from=2026-03-09&to=2026-03-08',
        'from=2026-01-01&to=2026-02-01',
        'from=2026-03-08&from=2026-03-08&to=2026-03-08',
        'from[nested]=2026-03-08&to=2026-03-08',
        'from=2026-03-08&to=2026-03-08&unexpected=x',
        'from=2026-03-08&to=2026-03-08&limit=101',
        'from=2026-03-08&to=2026-03-08&cursor=invalid',
        'from=2026-03-08&to=2026-03-08&routineId=00000000-0000-0000-0000-000000000000',
    ])('rejects invalid query %s', async (query: string): Promise<void> => {
        const response = await request(application.getHttpServer())
            .get(`${path()}?${query}`)
            .set('Authorization', `Bearer ${owner.token}`)
            .expect(400);

        expect(response.body).toEqual({
            code: 'INVALID_REQUEST',
            message: 'Request query is invalid',
        });
    });

    it.each(['invalid-id', '00000000-0000-0000-0000-000000000000'])(
        'rejects invalid path %s',
        async (id: string): Promise<void> => {
            const response = await request(application.getHttpServer())
                .get(path(id))
                .query(dates)
                .set('Authorization', `Bearer ${owner.token}`)
                .expect(400);

            expect(response.body).toEqual({
                code: 'INVALID_REQUEST',
                message: 'Pet id is invalid',
            });
        },
    );

    it('accepts a full 31-day inclusive range', async (): Promise<void> => {
        await request(application.getHttpServer())
            .get(path())
            .query({ from: '2026-03-01', to: '2026-03-31' })
            .set('Authorization', `Bearer ${owner.token}`)
            .expect(200);
    });

    it.each(['{', 'null', '42', '"text"'])(
        'authenticates before parser failure %s',
        async (body: string): Promise<void> => {
            for (const token of [null, 'invalid-token', owner.token]) {
                const pending = request(application.getHttpServer())
                    .get(`${path('invalid-id')}?from=invalid`)
                    .set('Content-Type', 'application/json')
                    .send(body);

                if (token !== null) {
                    pending.set('Authorization', `Bearer ${token}`);
                }

                const response = await pending.expect(token === owner.token ? 400 : 401);

                expect(response.body).toEqual(
                    token === owner.token
                        ? { code: 'INVALID_REQUEST', message: 'Request body is invalid' }
                        : { code: 'UNAUTHENTICATED', message: 'Authentication is required' },
                );
            }
        },
    );

    it('authenticates before path and query validation', async (): Promise<void> => {
        for (const token of [null, 'invalid-token']) {
            const pending = request(application.getHttpServer()).get(
                `${path('invalid-id')}?from=invalid`,
            );

            if (token !== null) {
                pending.set('Authorization', `Bearer ${token}`);
            }

            await pending.expect(401);
        }
    });
});
