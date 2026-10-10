import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { healthPetAllergies } from '../src/health/infrastructure/persistence/drizzle/health.schema';
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

describe('PATCH /pets/:petId/health/allergies/:allergyId (e2e)', () => {
    let application: INestApplication<App>;
    let database: DatabaseService;
    let owner: AccountFixture;
    let collaborator: AccountFixture;
    let outsider: AccountFixture;
    let petId: string;
    let collaboratorMembershipId: string;
    let allergyId: string;
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
        otherPetId = randomUUID();
        collaboratorMembershipId = randomUUID();
        await database.connection.insert(pets).values(
            [petId, otherPetId].map((identifier: string) => ({
                id: identifier,
                name: 'Allergy pet',
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

        allergyId = (created.body as { id: string }).id;
    });

    afterEach(async () => {
        await database.connection
            .delete(healthPetAllergies)
            .where(inArray(healthPetAllergies.petId, [petId, otherPetId]));
        await database.connection.delete(petMemberships).where(eq(petMemberships.petId, petId));
        await database.connection.delete(pets).where(inArray(pets.id, [petId, otherPetId]));
    });

    function path(id: string = petId): string {
        return `/pets/${id}/health/allergies`;
    }

    function body() {
        return {
            allergen: '  Penicillin  ',
            category: 'MEDICATION',
            severity: 'SEVERE',
            notes: '  Previous reaction reported by veterinarian.  ',
        };
    }

    function patchPath(targetPetId: string = petId, targetAllergyId: string = allergyId): string {
        return `/pets/${targetPetId}/health/allergies/${targetAllergyId}`;
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
            id: allergyId,
            petId,
            allergen: 'Penicillin',
            category: 'MEDICATION',
            severity: 'SEVERE',
            notes: 'Previous reaction reported by veterinarian.',
            recordedByAccountId: owner.id,
        };
    }

    it.each(['owner', 'collaborator'] as const)(
        'returns the exact response for %s with original authorship',
        async (role) => {
            const response = await patch(
                {
                    allergen: '  Amoxicillin  ',
                    category: 'OTHER',
                    severity: 'MODERATE',
                    notes: null,
                },
                role === 'owner' ? owner : collaborator,
            ).expect(200);

            expect(response.body).toEqual({
                ...initialResponse(),
                allergen: 'Amoxicillin',
                category: 'OTHER',
                severity: 'MODERATE',
                notes: null,
            });
            const list = await request(application.getHttpServer())
                .get(path())
                .set('Authorization', `Bearer ${collaborator.token}`)
                .expect(200);

            expect(list.body).toEqual({
                items: [
                    {
                        id: allergyId,
                        allergen: 'Amoxicillin',
                        category: 'OTHER',
                        severity: 'MODERATE',
                        notes: null,
                        recordedByAccountId: owner.id,
                    },
                ],
            });
        },
    );

    it.each([
        [{ allergen: '  Chicken  ' }, { allergen: 'Chicken' }],
        [{ category: 'FOOD' }, { category: 'FOOD' }],
        [{ severity: 'MILD' }, { severity: 'MILD' }],
        [{ notes: '  Corrected notes  ' }, { notes: 'Corrected notes' }],
        [{ notes: null }, { notes: null }],
        [
            { allergen: '🐕'.repeat(255), notes: '🐕'.repeat(2000) },
            { allergen: '🐕'.repeat(255), notes: '🐕'.repeat(2000) },
        ],
    ])('accepts partial correction %j and preserves omitted fields', async (payload, expected) => {
        const response = await patch(payload).expect(200);

        expect(response.body).toEqual({ ...initialResponse(), ...expected });
    });

    it('returns 200 with current representation for normalized and null no-ops', async () => {
        for (const payload of [
            { allergen: '  Penicillin  ' },
            { category: 'MEDICATION' },
            { severity: 'SEVERE' },
            { notes: '  Previous reaction reported by veterinarian.  ' },
        ]) {
            expect((await patch(payload).expect(200)).body).toEqual(initialResponse());
        }

        await patch({ notes: null }).expect(200);
        expect((await patch({ notes: null }).expect(200)).body).toEqual({
            ...initialResponse(),
            notes: null,
        });
    });

    it.each([
        [{ allergen: '' }, 'INVALID_ALLERGEN'],
        [{ allergen: ' ' }, 'INVALID_ALLERGEN'],
        [{ allergen: '🐕'.repeat(256) }, 'INVALID_ALLERGEN'],
        [{ category: 'food' }, 'INVALID_ALLERGY_CATEGORY'],
        [{ category: '' }, 'INVALID_ALLERGY_CATEGORY'],
        [{ severity: 'CRITICAL' }, 'INVALID_ALLERGY_SEVERITY'],
        [{ severity: '' }, 'INVALID_ALLERGY_SEVERITY'],
        [{ notes: '' }, 'INVALID_ALLERGY_NOTES'],
        [{ notes: ' ' }, 'INVALID_ALLERGY_NOTES'],
        [{ notes: '🐕'.repeat(2001) }, 'INVALID_ALLERGY_NOTES'],
    ])('maps semantic correction errors %j', async (payload, code) => {
        expect((await patch(payload).expect(400)).body).toMatchObject({ code });
    });

    it('rejects empty, non-object, wrong-type and forbidden-field bodies', async () => {
        const invalidBodies: unknown[] = [
            {},
            [],
            null,
            { allergen: null },
            { category: null },
            { severity: null },
            { allergen: 1 },
            { category: 1 },
            { severity: [] },
            { notes: 1 },
            { notes: {} },
        ];

        for (const field of [
            'id',
            'allergyId',
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
            invalidBodies.push({ severity: 'MILD', [field]: 'forbidden' });
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
                    (await patch({ severity: 'MILD' }, owner, target).expect(400)).body,
                ).toMatchObject({ code: 'INVALID_REQUEST' });
            }
        },
    );

    it('rejects all unexpected query parameters', async () => {
        for (const query of ['?limit=1', '?extra=', '?severity=MILD', '?extra=x&extra=y']) {
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
                    .send(
                        (typeof payload === 'object' && payload !== null) ||
                            typeof payload === 'string'
                            ? payload
                            : String(payload),
                    );

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
        const invalidSemantic = { allergen: '' };

        expect((await patch(invalidSemantic, outsider).expect(404)).body).toMatchObject({
            code: 'PET_NOT_FOUND',
        });
        expect(
            (await patch(invalidSemantic, owner, patchPath(randomUUID())).expect(404)).body,
        ).toMatchObject({ code: 'PET_NOT_FOUND' });
        expect(
            (await patch(invalidSemantic, owner, patchPath(petId, randomUUID())).expect(404)).body,
        ).toMatchObject({ code: 'PET_ALLERGY_NOT_FOUND' });
        const otherAllergyId: string = randomUUID();

        await database.connection.insert(healthPetAllergies).values({
            id: otherAllergyId,
            petId: otherPetId,
            allergen: 'Chicken',
            category: 'FOOD',
            severity: 'UNKNOWN',
            recordedByAccountId: owner.id,
        });
        expect(
            (await patch(invalidSemantic, owner, patchPath(petId, otherAllergyId)).expect(404))
                .body,
        ).toMatchObject({ code: 'PET_ALLERGY_NOT_FOUND' });
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
