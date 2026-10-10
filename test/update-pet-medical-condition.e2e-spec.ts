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

describe('PATCH /pets/:petId/health/medical-conditions/:conditionId (e2e)', () => {
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
            notes: 'Monitored periodically.',
            recordedByAccountId: owner.id,
        };
    }

    it.each(['owner', 'collaborator'] as const)(
        'returns full correction for %s and List reflects it',
        async (role) => {
            const response = await patch(
                { name: ' Osteoarthritis ', diagnosedDate: '2026-03-14', notes: null },
                role === 'owner' ? owner : collaborator,
            ).expect(200);

            expect(response.body).toEqual({
                ...initialResponse(),
                name: 'Osteoarthritis',
                diagnosedDate: '2026-03-14',
                notes: null,
            });
            const listed = await request(application.getHttpServer())
                .get(path())
                .set('Authorization', `Bearer ${collaborator.token}`)
                .expect(200);

            expect(listed.body).toEqual({
                items: [
                    {
                        id: conditionId,
                        name: 'Osteoarthritis',
                        status: 'ACTIVE',
                        diagnosedDate: '2026-03-14',
                        notes: null,
                        recordedByAccountId: owner.id,
                    },
                ],
            });
        },
    );
    it.each([
        [{ name: ' Arthritis ' }, { name: 'Arthritis' }],
        [{ diagnosedDate: '2026-03-14' }, { diagnosedDate: '2026-03-14' }],
        [{ diagnosedDate: null }, { diagnosedDate: null }],
        [{ notes: ' Corrected ' }, { notes: 'Corrected' }],
        [{ notes: null }, { notes: null }],
        [
            { name: '🐕'.repeat(255), notes: '🐕'.repeat(2000) },
            { name: '🐕'.repeat(255), notes: '🐕'.repeat(2000) },
        ],
    ])('accepts partial %j and preserves omitted fields', async (payload, expected) => {
        expect((await patch(payload).expect(200)).body).toEqual({
            ...initialResponse(),
            ...expected,
        });
    });
    it('returns the complete current representation for no-ops and preserves RESOLVED', async () => {
        for (const payload of [
            { name: ' Arthritis ' },
            { diagnosedDate: '2026-02-10' },
            { notes: ' Monitored periodically. ' },
        ]) {
            expect((await patch(payload).expect(200)).body).toEqual(initialResponse());
        }

        await database.connection
            .update(healthPetMedicalConditions)
            .set({ status: 'RESOLVED' })
            .where(eq(healthPetMedicalConditions.id, conditionId));
        expect((await patch({ name: ' Arthritis ' }).expect(200)).body).toEqual({
            ...initialResponse(),
            status: 'RESOLVED',
        });
        expect(
            (
                await patch({
                    name: 'Corrected',
                    diagnosedDate: null,
                    notes: null,
                }).expect(200)
            ).body,
        ).toEqual({
            ...initialResponse(),
            status: 'RESOLVED',
            name: 'Corrected',
            diagnosedDate: null,
            notes: null,
        });
        expect((await patch({ notes: null }).expect(200)).body).toMatchObject({
            status: 'RESOLVED',
            name: 'Corrected',
            diagnosedDate: null,
            notes: null,
        });
    });
    it('preserves historical future dates when omitted and validates explicit dates against current UTC today', async () => {
        await database.connection
            .update(healthPetMedicalConditions)
            .set({ status: 'RESOLVED', diagnosedDate: '2027-01-01' })
            .where(eq(healthPetMedicalConditions.id, conditionId));
        expect((await patch({ notes: 'Historical correction' }).expect(200)).body).toMatchObject({
            status: 'RESOLVED',
            diagnosedDate: '2027-01-01',
        });
        expect((await patch({ diagnosedDate: '2027-01-01' }).expect(400)).body).toMatchObject({
            code: 'INVALID_MEDICAL_CONDITION_DIAGNOSED_DATE',
        });
    });
    it.each([
        [{ name: '' }, 'INVALID_MEDICAL_CONDITION_NAME'],
        [{ name: ' ' }, 'INVALID_MEDICAL_CONDITION_NAME'],
        [{ name: '🐕'.repeat(256) }, 'INVALID_MEDICAL_CONDITION_NAME'],
        [{ diagnosedDate: '2026-02-29' }, 'INVALID_MEDICAL_CONDITION_DIAGNOSED_DATE'],
        [{ diagnosedDate: '2026-03-15' }, 'INVALID_MEDICAL_CONDITION_DIAGNOSED_DATE'],
        [{ diagnosedDate: '2026' }, 'INVALID_MEDICAL_CONDITION_DIAGNOSED_DATE'],
        [{ notes: '' }, 'INVALID_MEDICAL_CONDITION_NOTES'],
        [{ notes: ' ' }, 'INVALID_MEDICAL_CONDITION_NOTES'],
        [{ notes: '🐕'.repeat(2001) }, 'INVALID_MEDICAL_CONDITION_NOTES'],
    ])('maps semantic error %j', async (payload, code) => {
        expect((await patch(payload).expect(400)).body).toMatchObject({ code });
    });
    it('rejects empty, non-object, wrong-type and forbidden-field bodies', async () => {
        const invalidBodies: unknown[] = [
            {},
            [],
            null,
            { name: null },
            { diagnosedDate: [] },
            { diagnosedDate: {} },
            { name: 1 },
            { diagnosedDate: 1 },
            { name: [] },
            { notes: 1 },
            { notes: {} },
        ];

        for (const field of [
            'id',
            'conditionId',
            'petId',
            'recordedByAccountId',
            'createdAt',
            'updatedAt',
            'status',
            'identifiedDate',
            'updatedByAccountId',
            'lastModifiedBy',
            'extra',
        ]) {
            invalidBodies.push({ name: 'Corrected', [field]: 'forbidden' });
        }

        for (const payload of invalidBodies) {
            expect((await patch(payload).expect(400)).body).toMatchObject({
                code: 'INVALID_REQUEST',
            });
        }

        for (const scalar of ['"text"', '42', 'true', 'null', '{']) {
            const response = await request(application.getHttpServer())
                .patch(patchPath())
                .set('Authorization', `Bearer ${owner.token}`)
                .set('Content-Type', 'application/json')
                .send(scalar)
                .expect(400);

            expect(response.body).toMatchObject({ code: 'INVALID_REQUEST' });
        }
    });

    it.each(['bad', '00000000-0000-0000-0000-000000000000'])(
        'rejects invalid/nil UUID %s in either path parameter',
        async (identifier) => {
            for (const target of [patchPath(identifier), patchPath(petId, identifier)]) {
                expect(
                    (await patch({ name: 'Corrected' }, owner, target).expect(400)).body,
                ).toMatchObject({ code: 'INVALID_REQUEST' });
            }
        },
    );

    it('rejects all unexpected query parameters', async () => {
        for (const query of ['?limit=1', '?extra=', '?name=Corrected', '?extra=x&extra=y']) {
            expect(
                (await patch({ notes: null }, owner, patchPath() + query).expect(400)).body,
            ).toMatchObject({ code: 'INVALID_REQUEST' });
        }
    });

    it('requires authentication before HTTP validation', async () => {
        for (const token of [undefined, 'invalid-token']) {
            const action = request(application.getHttpServer())
                .patch(patchPath('invalid', 'invalid'))
                .send({});

            if (token !== undefined) {
                action.set('Authorization', `Bearer ${token}`);
            }

            expect((await action.expect(401)).body).toMatchObject({
                code: 'UNAUTHENTICATED',
            });
        }
    });

    it.each(['null', '42', 'true', '"text"', '{'])(
        'authenticates before parser rejection for %s',
        async (payload: string) => {
            for (const token of [undefined, 'invalid-token']) {
                const action = request(application.getHttpServer())
                    .patch(patchPath('invalid', 'invalid') + '?extra=true')
                    .set('Content-Type', 'application/json')
                    .send(payload);

                if (token !== undefined) {
                    action.set('Authorization', `Bearer ${token}`);
                }

                expect((await action.expect(401)).body).toMatchObject({
                    code: 'UNAUTHENTICATED',
                });
            }
        },
    );

    it('resolves targets only after authorizing access and before semantic correction', async () => {
        const invalidSemantic = { name: '' };

        expect((await patch(invalidSemantic, outsider).expect(404)).body).toMatchObject({
            code: 'PET_NOT_FOUND',
        });
        expect(
            (await patch(invalidSemantic, owner, patchPath(randomUUID())).expect(404)).body,
        ).toMatchObject({ code: 'PET_NOT_FOUND' });
        expect(
            (await patch(invalidSemantic, owner, patchPath(petId, randomUUID())).expect(404)).body,
        ).toMatchObject({ code: 'PET_MEDICAL_CONDITION_NOT_FOUND' });
        const otherConditionId: string = randomUUID();

        await database.connection.insert(healthPetMedicalConditions).values({
            id: otherConditionId,
            petId: otherPetId,
            name: 'Diabetes',

            recordedByAccountId: owner.id,
        });
        expect(
            (await patch(invalidSemantic, owner, patchPath(petId, otherConditionId)).expect(404))
                .body,
        ).toMatchObject({ code: 'PET_MEDICAL_CONDITION_NOT_FOUND' });
        await database.connection
            .update(petMemberships)
            .set({ status: 'INACTIVE' })
            .where(eq(petMemberships.id, collaboratorMembershipId));
        expect((await patch(invalidSemantic, collaborator).expect(404)).body).toMatchObject({
            code: 'PET_NOT_FOUND',
        });
        await database.connection
            .update(pets)
            .set({ status: 'ARCHIVED' })
            .where(eq(pets.id, petId));
        expect((await patch(invalidSemantic).expect(404)).body).toMatchObject({
            code: 'PET_NOT_FOUND',
        });
        expect((await patch({}).expect(400)).body).toMatchObject({
            code: 'INVALID_REQUEST',
        });
    });
});
