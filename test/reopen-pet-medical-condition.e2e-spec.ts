import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { HEALTH_CLOCK } from '../src/health/application/time/clock';
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

describe('POST /pets/:petId/health/medical-conditions/:conditionId/reopen (e2e)', () => {
    let application: INestApplication<App>;
    let database: DatabaseService;
    let owner: AccountFixture;
    let collaborator: AccountFixture;
    let outsider: AccountFixture;
    let petId: string;
    let collaboratorMembershipId: string;
    let conditionId: string;
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
        const fixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        })
            .overrideProvider(HEALTH_CLOCK)
            .useValue({ now: (): Date => new Date('2026-03-14T00:30:00Z') })
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
        otherPetId = randomUUID();
        collaboratorMembershipId = randomUUID();
        await database.connection.insert(pets).values(
            [petId, otherPetId].map((identifier: string) => ({
                id: identifier,
                name: 'Medical condition pet',
                species: 'DOG',
                breedName: 'Mixed',
                breedKind: 'CUSTOM',
                sex: 'UNKNOWN',
                birthDate: '2020-01-01',
                birthDateAccuracy: 'EXACT',
                status: 'ACTIVE',
            })),
        );
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
        const created = await request(application.getHttpServer())
            .post(path())
            .set('Authorization', `Bearer ${owner.token}`)
            .send(body())
            .expect(201);

        conditionId = (created.body as { id: string }).id;
    });

    afterEach(async () => {
        await database.connection
            .delete(healthPetMedicalConditions)
            .where(inArray(healthPetMedicalConditions.petId, [petId, otherPetId]));
        await database.connection.delete(petMemberships).where(eq(petMemberships.petId, petId));
        await database.connection.delete(pets).where(inArray(pets.id, [petId, otherPetId]));
    });

    function path(id: string = petId): string {
        return `/pets/${id}/health/medical-conditions`;
    }

    function body() {
        return {
            name: '  Arthritis  ',
            diagnosedDate: '2026-02-10',
            notes: '  Monitored periodically.  ',
        };
    }

    function patchPath(
        targetPetId: string = petId,
        targetConditionId: string = conditionId,
    ): string {
        return `/pets/${targetPetId}/health/medical-conditions/${targetConditionId}`;
    }

    function patch(
        payload: unknown,
        account: AccountFixture = owner,
        target: string = patchPath(),
    ) {
        return request(application.getHttpServer())
            .patch(target)
            .set('Authorization', `Bearer ${account.token}`)
            .set('Content-Type', 'application/json')
            .send(
                (typeof payload === 'object' && payload !== null) || typeof payload === 'string'
                    ? payload
                    : String(payload),
            );
    }

    function initialResponse() {
        return {
            id: conditionId,
            petId,
            name: 'Arthritis',
            status: 'ACTIVE',
            diagnosedDate: '2026-02-10',
            resolvedDate: null,
            notes: 'Monitored periodically.',
            recordedByAccountId: owner.id,
        };
    }

    function resolve(
        payload: unknown,
        account: AccountFixture = owner,
        target: string = patchPath() + '/resolve',
    ) {
        return request(application.getHttpServer())
            .post(target)
            .set('Authorization', `Bearer ${account.token}`)
            .set('Content-Type', 'application/json')
            .send(typeof payload === 'string' ? payload : JSON.stringify(payload));
    }

    function reopen(
        payload?: unknown,
        account: AccountFixture = owner,
        target: string = patchPath() + '/reopen',
    ) {
        const action = request(application.getHttpServer())
            .post(target)
            .set('Authorization', `Bearer ${account.token}`);

        if (payload !== undefined) {
            action
                .set('Content-Type', 'application/json')
                .send(typeof payload === 'string' ? payload : JSON.stringify(payload));
        }

        return action;
    }

    it.each(['owner', 'collaborator'] as const)(
        'Record → Resolve → Reopen → List returns exact representation as %s',
        async (role) => {
            const account = role === 'owner' ? owner : collaborator;

            await resolve({ resolvedDate: '2026-03-14' }).expect(200);
            expect((await reopen(undefined, account).expect(200)).body).toEqual(initialResponse());
            expect((await reopen({}, account).expect(200)).body).toEqual(initialResponse());
            const { petId: omittedPetId, ...item } = initialResponse();

            expect(omittedPetId).toBe(petId);
            expect(
                (
                    await request(application.getHttpServer())
                        .get(path())
                        .set('Authorization', `Bearer ${account.token}`)
                        .expect(200)
                ).body,
            ).toEqual({ items: [item] });
            expect(
                (
                    await patch({
                        name: 'Corrected',
                        diagnosedDate: null,
                        notes: 'Corrected notes',
                    }).expect(200)
                ).body,
            ).toEqual({
                ...initialResponse(),
                name: 'Corrected',
                diagnosedDate: null,
                notes: 'Corrected notes',
            });
        },
    );

    it('accepts an empty body for a transition with an unknown resolution date', async () => {
        await resolve({ resolvedDate: null }).expect(200);
        expect((await reopen({}).expect(200)).body).toEqual(initialResponse());
    });

    it('accepts a no-op on an initially ACTIVE condition', async () => {
        expect((await reopen().expect(200)).body).toEqual(initialResponse());
    });

    it('a Reopen after a new resolution changes the current state again', async () => {
        await resolve({ resolvedDate: '2026-03-14' }).expect(200);
        await reopen().expect(200);
        await resolve({ resolvedDate: '2026-03-13' }).expect(200);
        expect((await reopen().expect(200)).body).toEqual(initialResponse());
    });

    it.each([
        { resolvedDate: null },
        { status: 'ACTIVE' },
        { reason: 'Mistake' },
        { reopenedDate: '2026-03-14' },
        { unexpected: true },
        [],
        null,
        '42',
        'true',
        '"text"',
        '{',
    ])('rejects body %j before Pet authorization', async (payload) => {
        expect((await reopen(payload, outsider).expect(400)).body).toMatchObject({
            code: 'INVALID_REQUEST',
        });
    });

    it('rejects invalid or nil UUIDs in either path and unexpected query parameters', async () => {
        const nilId: string = '00000000-0000-0000-0000-000000000000';

        for (const target of [
            patchPath('bad'),
            patchPath(nilId),
            patchPath(petId, 'bad'),
            patchPath(petId, nilId),
            patchPath() + '/reopen?unexpected=true',
        ]) {
            const route: string = target.includes('?') ? target : target + '/reopen';

            expect((await reopen({}, owner, route).expect(400)).body).toMatchObject({
                code: 'INVALID_REQUEST',
            });
        }
    });
    it('requires JWT before structural and malformed JSON validation', async () => {
        for (const token of [null, 'invalid']) {
            for (const payload of ['{', 'null', '{}']) {
                const action = request(application.getHttpServer())
                    .post(patchPath() + '/reopen')
                    .set('Content-Type', 'application/json')
                    .send(payload);

                if (token !== null) {
                    action.set('Authorization', `Bearer ${token}`);
                }

                expect((await action.expect(401)).body).toMatchObject({ code: 'UNAUTHENTICATED' });
            }
        }

        expect((await reopen('{').expect(400)).body).toMatchObject({ code: 'INVALID_REQUEST' });
    });

    it('preserves authorization and target precedence after HTTP validation', async () => {
        const empty = {};

        expect((await reopen(empty, outsider).expect(404)).body).toMatchObject({
            code: 'PET_NOT_FOUND',
        });
        expect(
            (await reopen(empty, owner, patchPath(randomUUID()) + '/reopen').expect(404)).body,
        ).toMatchObject({ code: 'PET_NOT_FOUND' });
        expect(
            (await reopen(empty, owner, patchPath(petId, randomUUID()) + '/reopen').expect(404))
                .body,
        ).toMatchObject({ code: 'PET_MEDICAL_CONDITION_NOT_FOUND' });
        const otherId: string = randomUUID();

        await database.connection.insert(healthPetMedicalConditions).values({
            id: otherId,
            petId: otherPetId,
            name: 'Other',
            recordedByAccountId: owner.id,
        });
        expect(
            (await reopen(empty, owner, patchPath(petId, otherId) + '/reopen').expect(404)).body,
        ).toMatchObject({ code: 'PET_MEDICAL_CONDITION_NOT_FOUND' });
        await database.connection
            .update(petMemberships)
            .set({ status: 'INACTIVE' })
            .where(eq(petMemberships.id, collaboratorMembershipId));
        expect((await reopen(empty, collaborator).expect(404)).body).toMatchObject({
            code: 'PET_NOT_FOUND',
        });
        await database.connection
            .update(pets)
            .set({ status: 'ARCHIVED' })
            .where(eq(pets.id, petId));
        expect((await reopen(empty).expect(404)).body).toMatchObject({ code: 'PET_NOT_FOUND' });
        expect(
            (
                await request(application.getHttpServer())
                    .get(path())
                    .set('Authorization', `Bearer ${owner.token}`)
                    .expect(200)
            ).body,
        ).toMatchObject({ items: [expect.objectContaining({ id: conditionId })] });
    });
});
