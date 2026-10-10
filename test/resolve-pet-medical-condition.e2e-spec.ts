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

describe('POST /pets/:petId/health/medical-conditions/:conditionId/resolve (e2e)', () => {
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
            .send(typeof payload === 'object' && payload !== null ? payload : String(payload));
    }

    it.each(['owner', 'collaborator'] as const)(
        'returns exact resolved representation as %s and preserves it on retry',
        async (role) => {
            const account = role === 'owner' ? owner : collaborator;
            const expected = {
                ...initialResponse(),
                status: 'RESOLVED',
                resolvedDate: '2026-03-14',
            };

            expect(
                (await resolve({ resolvedDate: '2026-03-14' }, account).expect(200)).body,
            ).toEqual(expected);

            for (const resolvedDate of ['invalid', '9999-01-01', '2026-03-13', null]) {
                expect((await resolve({ resolvedDate }, account).expect(200)).body).toEqual(
                    expected,
                );
            }

            const { petId: omittedPetId, ...item } = expected;

            expect(omittedPetId).toBe(petId);
            expect(
                (
                    await request(application.getHttpServer())
                        .get(path())
                        .set('Authorization', `Bearer ${owner.token}`)
                        .expect(200)
                ).body,
            ).toEqual({ items: [item] });
            expect((await patch({ notes: 'Corrected' }).expect(200)).body).toEqual({
                ...expected,
                notes: 'Corrected',
            });

            for (const payload of [{ status: 'ACTIVE' }, { resolvedDate: null }]) {
                expect((await patch(payload).expect(400)).body).toMatchObject({
                    code: 'INVALID_REQUEST',
                });
            }
        },
    );

    it('supports an unknown resolution date', async () => {
        expect((await resolve({ resolvedDate: null }).expect(200)).body).toEqual({
            ...initialResponse(),
            status: 'RESOLVED',
        });
    });

    it.each([
        {},
        { resolvedDate: 42 },
        { resolvedDate: true },
        { resolvedDate: null, status: 'RESOLVED' },
        [],
        null,
    ])('rejects structural body %j', async (payload) => {
        expect((await resolve(payload).expect(400)).body).toMatchObject({
            code: 'INVALID_REQUEST',
        });
    });

    it.each(['invalid', '2026-02-29', '2026-03-15'])(
        'rejects new semantic date %s',
        async (resolvedDate) => {
            expect((await resolve({ resolvedDate }).expect(400)).body).toMatchObject({
                code: 'INVALID_MEDICAL_CONDITION_RESOLVED_DATE',
            });
        },
    );

    it('rejects missing body, invalid UUIDs and unexpected query parameters', async () => {
        expect(
            (
                await request(application.getHttpServer())
                    .post(patchPath() + '/resolve')
                    .set('Authorization', `Bearer ${owner.token}`)
                    .expect(400)
            ).body,
        ).toMatchObject({ code: 'INVALID_REQUEST' });

        for (const target of [
            patchPath('bad') + '/resolve',
            patchPath(petId, '00000000-0000-0000-0000-000000000000') + '/resolve',
            patchPath() + '/resolve?unexpected=true',
        ]) {
            expect(
                (await resolve({ resolvedDate: null }, owner, target).expect(400)).body,
            ).toMatchObject({ code: 'INVALID_REQUEST' });
        }
    });

    it('requires JWT before structural and malformed JSON validation', async () => {
        for (const token of [null, 'invalid']) {
            for (const payload of ['{', 'null', '{}']) {
                const action = request(application.getHttpServer())
                    .post(patchPath() + '/resolve')
                    .set('Content-Type', 'application/json')
                    .send(payload);

                if (token !== null) {
                    action.set('Authorization', `Bearer ${token}`);
                }

                expect((await action.expect(401)).body).toMatchObject({ code: 'UNAUTHENTICATED' });
            }
        }

        expect((await resolve('{').expect(400)).body).toMatchObject({ code: 'INVALID_REQUEST' });
    });

    it('preserves authorization and target precedence over semantic validation', async () => {
        const invalid = { resolvedDate: 'invalid' };

        expect((await resolve(invalid, outsider).expect(404)).body).toMatchObject({
            code: 'PET_NOT_FOUND',
        });
        expect(
            (await resolve(invalid, owner, patchPath(randomUUID()) + '/resolve').expect(404)).body,
        ).toMatchObject({ code: 'PET_NOT_FOUND' });
        expect(
            (await resolve(invalid, owner, patchPath(petId, randomUUID()) + '/resolve').expect(404))
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
            (await resolve(invalid, owner, patchPath(petId, otherId) + '/resolve').expect(404))
                .body,
        ).toMatchObject({ code: 'PET_MEDICAL_CONDITION_NOT_FOUND' });
        await database.connection
            .update(petMemberships)
            .set({ status: 'INACTIVE' })
            .where(eq(petMemberships.id, collaboratorMembershipId));
        expect((await resolve(invalid, collaborator).expect(404)).body).toMatchObject({
            code: 'PET_NOT_FOUND',
        });
        await database.connection
            .update(pets)
            .set({ status: 'ARCHIVED' })
            .where(eq(pets.id, petId));
        expect((await resolve(invalid).expect(404)).body).toMatchObject({ code: 'PET_NOT_FOUND' });
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
