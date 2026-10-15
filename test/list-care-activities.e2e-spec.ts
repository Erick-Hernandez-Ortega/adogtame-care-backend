import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import type { CareActivityListItem } from '../src/care/application/persistence/care-activity.reader';
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

describe('GET /pets/:petId/care/activities (e2e)', () => {
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
        return `/pets/${requestedPetId}/care/activities`;
    }

    async function record(
        author: AccountFixture = collaborator,
        requestedPetId: string = petId,
    ): Promise<CareActivityListItem> {
        const routineResponse = await request(application.getHttpServer())
            .post(`/pets/${requestedPetId}/care/routines`)
            .set('Authorization', `Bearer ${owner.token}`)
            .send({
                type: 'WALK',
                title: 'Walk',
                frequency: { period: 'DAILY', timesPerPeriod: 1 },
                timezone: 'UTC',
            })
            .expect(201);
        const routineId: string = (routineResponse.body as { id: string }).id;
        const response = await request(application.getHttpServer())
            .post(`/pets/${requestedPetId}/care/routines/${routineId}/activities`)
            .set('Authorization', `Bearer ${author.token}`)
            .send({
                completedAt: '2026-03-08T05:00:00Z',
                timezone: 'America/New_York',
                notes: '  Done  ',
            })
            .expect(201);
        const activity: { id: string } = response.body as { id: string };

        return {
            id: activity.id,
            routineId,
            completedAt: '2026-03-08T05:00:00.000Z',
            completedBy: author.id,
            timezone: 'America/New_York',
            localDay: '2026-03-08',
            notes: 'Done',
        };
    }

    it.each([
        { status: 'ACTIVE', role: 'OWNER' },
        { status: 'ACTIVE', role: 'COLLABORATOR' },
        { status: 'ARCHIVED', role: 'OWNER' },
        { status: 'ARCHIVED', role: 'COLLABORATOR' },
    ] as const)(
        'returns the exact history for $status pets as $role',
        async ({ status, role }): Promise<void> => {
            const item: CareActivityListItem = await record();

            await record(owner, otherPetId);

            if (status === 'ARCHIVED') {
                await request(application.getHttpServer())
                    .post(`/pets/${petId}/archive`)
                    .set('Authorization', `Bearer ${owner.token}`)
                    .expect(204);
            }

            const requester: AccountFixture = role === 'OWNER' ? owner : collaborator;
            const response = await request(application.getHttpServer())
                .get(path())
                .set('Authorization', `Bearer ${requester.token}`)
                .expect(200);

            expect(response.body).toEqual({ nextCursor: null, items: [item] });
        },
    );

    it('returns empty items for accessible pets without matching activities and combines inclusive filters', async (): Promise<void> => {
        const empty = await request(application.getHttpServer())
            .get(path())
            .set('Authorization', `Bearer ${owner.token}`)
            .expect(200);

        expect(empty.body).toEqual({ nextCursor: null, items: [] });
        const item: CareActivityListItem = await record();

        await record();
        const matching = await request(application.getHttpServer())
            .get(path())
            .query({ from: '2026-03-08', to: '2026-03-08', routineId: item.routineId })
            .set('Authorization', `Bearer ${owner.token}`)
            .expect(200);

        expect(matching.body).toEqual({ nextCursor: null, items: [item] });
        const other: CareActivityListItem = await record(owner, otherPetId);

        for (const filters of [
            { from: '2026-03-09' },
            { to: '2026-03-07' },
            { routineId: randomUUID() },
            { routineId: other.routineId },
        ]) {
            const response = await request(application.getHttpServer())
                .get(path())
                .query(filters)
                .set('Authorization', `Bearer ${owner.token}`)
                .expect(200);

            expect(response.body).toEqual({ nextCursor: null, items: [] });
        }
    });

    it('hides missing pets, outsiders and inactive recorders of either role', async (): Promise<void> => {
        await record(owner);
        await record();

        for (const requester of [owner, collaborator]) {
            await database.connection
                .update(petMemberships)
                .set({ status: 'INACTIVE' })
                .where(
                    and(
                        eq(petMemberships.petId, petId),
                        eq(petMemberships.accountId, requester.id),
                    ),
                );
            const response = await request(application.getHttpServer())
                .get(path())
                .query({ routineId: randomUUID() })
                .set('Authorization', `Bearer ${requester.token}`)
                .expect(404);

            expect(response.body).toEqual({ code: 'PET_NOT_FOUND', message: 'Pet was not found' });
        }

        for (const requestedPetId of [petId, randomUUID()]) {
            const response = await request(application.getHttpServer())
                .get(path(requestedPetId))
                .set('Authorization', `Bearer ${outsider.token}`)
                .expect(404);

            expect(response.body).toEqual({ code: 'PET_NOT_FOUND', message: 'Pet was not found' });
        }
    });

    it.each(['invalid-id', '00000000-0000-0000-0000-000000000000'])(
        'rejects invalid pet ID %s',
        async (requestedPetId: string): Promise<void> => {
            const response = await request(application.getHttpServer())
                .get(path(requestedPetId))
                .set('Authorization', `Bearer ${owner.token}`)
                .expect(400);

            expect(response.body).toEqual({
                code: 'INVALID_REQUEST',
                message: 'Pet id is invalid',
            });
        },
    );

    it.each([
        'from=',
        'to=',
        'from=2026-02-29',
        'to=2026-04-31',
        'from=0000-01-01',
        'from=2026-3-08',
        'from=2026-03-08T00:00:00Z',
        'to=2026-03-08%0A',
        'from=2026-03-09&to=2026-03-08',
        'from=2026-03-08&from=2026-03-09',
        'to=2026-03-08&to=2026-03-09',
        'routineId=invalid',
        'routineId=00000000-0000-0000-0000-000000000000',
        'routineId=10000000-0000-4000-8000-000000000001&routineId=10000000-0000-4000-8000-000000000002',
        'routineId[nested]=x',
        'from[nested]=2026-03-08',
        'cursor=x',
        'unexpected=x',
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

    it.each([
        'from=0001-01-01',
        'to=9999-12-31',
        'from=2024-02-29',
        'from=2026-03-08&to=2026-03-08',
    ])('accepts valid query %s', async (query: string): Promise<void> => {
        await request(application.getHttpServer())
            .get(`${path()}?${query}`)
            .set('Authorization', `Bearer ${owner.token}`)
            .expect(200);
    });

    it('authenticates before path and query validation', async (): Promise<void> => {
        for (const token of [null, 'invalid-token']) {
            const pending = request(application.getHttpServer()).get(
                `${path('invalid-id')}?from=invalid`,
            );

            if (token !== null) {
                pending.set('Authorization', `Bearer ${token}`);
            }

            const response = await pending.expect(401);

            expect(response.body).toEqual({
                code: 'UNAUTHENTICATED',
                message: 'Authentication is required',
            });
        }
    });

    it.each(['{', 'null', '42', '"text"'])(
        'authenticates before JSON parser failure %s',
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
});
