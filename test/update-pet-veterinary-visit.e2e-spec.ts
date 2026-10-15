import { configureSecurityHeaders } from '../src/infrastructure/http/configure-security-headers';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { HEALTH_CLOCK } from '../src/health/application/time/clock';
import { AppModule } from '../src/app.module';
import { healthPetVeterinaryVisits } from '../src/health/infrastructure/persistence/drizzle/health.schema';
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

describe('PATCH /pets/:petId/health/veterinary-visits/:visitId (e2e)', () => {
    let application: INestApplication<App>;
    let database: DatabaseService;
    let owner: AccountFixture;
    let collaborator: AccountFixture;
    let outsider: AccountFixture;
    let petId: string;
    let collaboratorMembershipId: string;
    let visitId: string;
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
        configureSecurityHeaders(application);
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
                name: 'Veterinary visit pet',
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

        visitId = (created.body as { id: string }).id;
    });

    afterEach(async () => {
        await database.connection
            .delete(healthPetVeterinaryVisits)
            .where(inArray(healthPetVeterinaryVisits.petId, [petId, otherPetId]));
        await database.connection.delete(petMemberships).where(eq(petMemberships.petId, petId));
        await database.connection.delete(pets).where(inArray(pets.id, [petId, otherPetId]));
    });

    function path(id: string = petId): string {
        return `/pets/${id}/health/veterinary-visits`;
    }

    function body() {
        return {
            reason: '  Arthritis  ',
            visitDate: '2026-02-10',
            observations: '  Monitored periodically.  ',
        };
    }

    function patchPath(targetPetId: string = petId, targetVisitId: string = visitId): string {
        return `/pets/${targetPetId}/health/veterinary-visits/${targetVisitId}`;
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
            id: visitId,
            petId,
            reason: 'Arthritis',
            visitDate: '2026-02-10',
            diagnosis: null,
            observations: 'Monitored periodically.',
            recordedByAccountId: owner.id,
        };
    }

    it.each(['owner', 'collaborator'] as const)(
        'returns full correction for %s and List reflects it',
        async (role) => {
            const response = await patch(
                { reason: ' Osteoarthritis ', visitDate: '2026-03-14', observations: null },
                role === 'owner' ? owner : collaborator,
            ).expect(200);

            expect(response.body).toEqual({
                ...initialResponse(),
                reason: 'Osteoarthritis',
                visitDate: '2026-03-14',
                observations: null,
            });
            const listed = await request(application.getHttpServer())
                .get(path())
                .set('Authorization', `Bearer ${collaborator.token}`)
                .expect(200);

            expect(listed.body).toEqual({
                nextCursor: null,
                items: [
                    {
                        id: visitId,
                        reason: 'Osteoarthritis',
                        visitDate: '2026-03-14',
                        diagnosis: null,
                        observations: null,
                        recordedByAccountId: owner.id,
                    },
                ],
            });
        },
    );
    it.each([
        [{ reason: ' Arthritis ' }, { reason: 'Arthritis' }],
        [{ visitDate: '2026-03-14' }, { visitDate: '2026-03-14' }],
        [{ diagnosis: null }, { diagnosis: null }],
        [{ diagnosis: ' Corrected ' }, { diagnosis: 'Corrected' }],
        [{ observations: '🐕'.repeat(5000) }, { observations: '🐕'.repeat(5000) }],
        [{ observations: ' Corrected ' }, { observations: 'Corrected' }],
        [{ observations: null }, { observations: null }],
        [
            { reason: '🐕'.repeat(255), observations: '🐕'.repeat(2000) },
            { reason: '🐕'.repeat(255), observations: '🐕'.repeat(2000) },
        ],
    ])('accepts partial %j and preserves omitted fields', async (payload, expected) => {
        expect((await patch(payload).expect(200)).body).toEqual({
            ...initialResponse(),
            ...expected,
        });
    });
    it('returns the complete current representation for normalized no-ops', async () => {
        for (const payload of [
            { reason: ' Arthritis ' },
            { visitDate: '2026-02-10' },
            { diagnosis: null },
            { observations: ' Monitored periodically. ' },
        ]) {
            expect((await patch(payload).expect(200)).body).toEqual(initialResponse());
        }
    });
    it('preserves historical future dates when omitted and validates explicit dates against current UTC today', async () => {
        await database.connection
            .update(healthPetVeterinaryVisits)
            .set({ visitDate: '2027-01-01' })
            .where(eq(healthPetVeterinaryVisits.id, visitId));
        expect(
            (await patch({ observations: 'Historical correction' }).expect(200)).body,
        ).toMatchObject({
            visitDate: '2027-01-01',
        });
        expect((await patch({ visitDate: '2027-01-01' }).expect(400)).body).toMatchObject({
            code: 'INVALID_VETERINARY_VISIT_DATE',
        });
    });
    it.each([
        [{ reason: '' }, 'INVALID_VETERINARY_VISIT_REASON'],
        [{ reason: ' ' }, 'INVALID_VETERINARY_VISIT_REASON'],
        [{ reason: '🐕'.repeat(256) }, 'INVALID_VETERINARY_VISIT_REASON'],
        [{ visitDate: '2026-02-29' }, 'INVALID_VETERINARY_VISIT_DATE'],
        [{ visitDate: '2026-03-15' }, 'INVALID_VETERINARY_VISIT_DATE'],
        [{ visitDate: '2026' }, 'INVALID_VETERINARY_VISIT_DATE'],
        [{ diagnosis: '' }, 'INVALID_VETERINARY_VISIT_DIAGNOSIS'],
        [{ diagnosis: '🐕'.repeat(2001) }, 'INVALID_VETERINARY_VISIT_DIAGNOSIS'],
        [{ observations: '' }, 'INVALID_VETERINARY_VISIT_OBSERVATIONS'],
        [{ observations: ' ' }, 'INVALID_VETERINARY_VISIT_OBSERVATIONS'],
        [{ observations: '🐕'.repeat(5001) }, 'INVALID_VETERINARY_VISIT_OBSERVATIONS'],
    ])('maps semantic error %j', async (payload, code) => {
        expect((await patch(payload).expect(400)).body).toMatchObject({ code });
    });
    it('rejects empty, non-object, wrong-type and forbidden-field bodies', async () => {
        const invalidBodies: unknown[] = [
            {},
            [],
            null,
            { reason: null },
            { visitDate: null },
            { diagnosis: 1 },
            { diagnosis: {} },
            { visitDate: [] },
            { visitDate: {} },
            { reason: 1 },
            { visitDate: 1 },
            { reason: [] },
            { observations: 1 },
            { observations: {} },
        ];

        for (const field of [
            'id',
            'visitId',
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
            invalidBodies.push({ reason: 'Corrected', [field]: 'forbidden' });
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
                    (await patch({ reason: 'Corrected' }, owner, target).expect(400)).body,
                ).toMatchObject({ code: 'INVALID_REQUEST' });
            }
        },
    );

    it('rejects all unexpected query parameters', async () => {
        for (const query of ['?limit=1', '?extra=', '?reason=Corrected', '?extra=x&extra=y']) {
            expect(
                (await patch({ observations: null }, owner, patchPath() + query).expect(400)).body,
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
        const invalidSemantic = { reason: '' };

        expect((await patch(invalidSemantic, outsider).expect(404)).body).toMatchObject({
            code: 'PET_NOT_FOUND',
        });
        expect(
            (await patch(invalidSemantic, owner, patchPath(randomUUID())).expect(404)).body,
        ).toMatchObject({ code: 'PET_NOT_FOUND' });
        expect(
            (await patch(invalidSemantic, owner, patchPath(petId, randomUUID())).expect(404)).body,
        ).toMatchObject({ code: 'PET_VETERINARY_VISIT_NOT_FOUND' });
        const otherVisitId: string = randomUUID();

        await database.connection.insert(healthPetVeterinaryVisits).values({
            id: otherVisitId,
            petId: otherPetId,
            reason: 'Diabetes',
            visitDate: '2026-02-10',

            recordedByAccountId: owner.id,
        });
        expect(
            (await patch(invalidSemantic, owner, patchPath(petId, otherVisitId)).expect(404)).body,
        ).toMatchObject({ code: 'PET_VETERINARY_VISIT_NOT_FOUND' });
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
