import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
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

describe('POST /pets/:petId/health/allergies (e2e)', () => {
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
            name: 'Allergy pet',
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
        await database.connection
            .delete(healthPetAllergies)
            .where(eq(healthPetAllergies.petId, petId));
        await database.connection.delete(petMemberships).where(eq(petMemberships.petId, petId));
        await database.connection.delete(pets).where(eq(pets.id, petId));
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

    it.each(['owner', 'collaborator'] as const)(
        'returns the exact normalized response for %s',
        async (role: 'owner' | 'collaborator') => {
            const account: AccountFixture = role === 'owner' ? owner : collaborator;
            const response = await request(application.getHttpServer())
                .post(path())
                .set('Authorization', `Bearer ${account.token}`)
                .send(body())
                .expect(201);
            const result = response.body as { id: string };

            expect(result.id).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
            );
            expect(response.body).toEqual({
                id: result.id,
                petId,
                allergen: 'Penicillin',
                category: 'MEDICATION',
                severity: 'SEVERE',
                notes: 'Previous reaction reported by veterinarian.',
                recordedByAccountId: account.id,
            });
        },
    );

    it('accepts absent and null notes, preserves Unicode limits and permits duplicates', async () => {
        const requestBody = {
            allergen: 'Chicken',
            category: 'FOOD',
            severity: 'UNKNOWN',
        };

        for (const payload of [
            requestBody,
            { ...requestBody, notes: null },
            { ...requestBody, allergen: '🐕'.repeat(255), notes: '🐕'.repeat(2000) },
        ]) {
            const response = await request(application.getHttpServer())
                .post(path())
                .set('Authorization', `Bearer ${owner.token}`)
                .send(payload)
                .expect(201);

            expect(response.body).toMatchObject({
                ...payload,
                notes: 'notes' in payload ? payload.notes : null,
            });
        }

        await request(application.getHttpServer())
            .post(path())
            .set('Authorization', `Bearer ${owner.token}`)
            .send(requestBody)
            .expect(201);
        const rows = await database.connection
            .select()
            .from(healthPetAllergies)
            .where(eq(healthPetAllergies.petId, petId));

        expect(rows).toHaveLength(4);
        expect(new Set(rows.map((row) => row.id)).size).toBe(4);
    });

    it.each([
        [{ allergen: '' }, 'INVALID_ALLERGEN'],
        [{ allergen: ' ' }, 'INVALID_ALLERGEN'],
        [{ allergen: 'x'.repeat(256) }, 'INVALID_ALLERGEN'],
        [{ category: 'food' }, 'INVALID_ALLERGY_CATEGORY'],
        [{ category: '' }, 'INVALID_ALLERGY_CATEGORY'],
        [{ severity: 'CRITICAL' }, 'INVALID_ALLERGY_SEVERITY'],
        [{ severity: '' }, 'INVALID_ALLERGY_SEVERITY'],
        [{ notes: '' }, 'INVALID_ALLERGY_NOTES'],
        [{ notes: ' ' }, 'INVALID_ALLERGY_NOTES'],
        [{ notes: 'x'.repeat(2001) }, 'INVALID_ALLERGY_NOTES'],
    ])('maps domain validation errors', async (overrides, code) => {
        const response = await request(application.getHttpServer())
            .post(path())
            .set('Authorization', `Bearer ${owner.token}`)
            .send({ ...body(), ...overrides })
            .expect(400);

        expect(response.body).toMatchObject({
            code,
            message: expect.any(String) as string,
        });
    });

    it('rejects missing fields, wrong types, and additional fields', async () => {
        const { allergen, category, severity, ...optionalFields } = body();
        const invalidBodies: unknown[] = [
            { ...optionalFields, category, severity },
            { ...optionalFields, allergen, severity },
            { ...optionalFields, allergen, category },
            { ...body(), allergen: null },
            { ...body(), allergen: 1 },
            { ...body(), category: null },
            { ...body(), category: 1 },
            { ...body(), severity: null },
            { ...body(), severity: 1 },
            { ...body(), notes: 1 },
            { ...body(), notes: [] },
            { ...body(), extra: true },
            { ...body(), petId },
            { ...body(), recordedByAccountId: owner.id },
            { ...body(), id: randomUUID() },
            { ...body(), allergyId: randomUUID() },
            { ...body(), createdAt: '2026-01-01' },
            { ...body(), updatedAt: '2026-01-01' },
            { ...body(), identifiedDate: '2026-01-01' },
            { ...body(), status: 'ACTIVE' },
            [],
            null,
        ];

        for (const payload of invalidBodies) {
            const response = await request(application.getHttpServer())
                .post(path())
                .set('Authorization', `Bearer ${owner.token}`)
                .send(payload)
                .expect(400);

            expect(response.body).toMatchObject({ code: 'INVALID_REQUEST' });
        }

        expect(
            await database.connection
                .select()
                .from(healthPetAllergies)
                .where(eq(healthPetAllergies.petId, petId)),
        ).toHaveLength(0);
    });

    it.each(['bad', '00000000-0000-0000-0000-000000000000'])(
        'rejects invalid pet UUID %s',
        async (identifier: string) => {
            const response = await request(application.getHttpServer())
                .post(path(identifier))
                .set('Authorization', `Bearer ${owner.token}`)
                .send(body())
                .expect(400);

            expect(response.body).toMatchObject({ code: 'INVALID_REQUEST' });
        },
    );

    it('rejects missing and invalid JWTs', async () => {
        const missing = await request(application.getHttpServer())
            .post(path())
            .send(body())
            .expect(401);

        expect(missing.body).toMatchObject({ code: 'UNAUTHENTICATED' });
        const invalid = await request(application.getHttpServer())
            .post(path())
            .set('Authorization', 'Bearer invalid-token')
            .send(body())
            .expect(401);

        expect(invalid.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('hides missing, archived, inactive, and unjoined pets', async () => {
        const outsiderResponse = await request(application.getHttpServer())
            .post(path())
            .set('Authorization', `Bearer ${outsider.token}`)
            .send(body())
            .expect(404);

        expect(outsiderResponse.body).toMatchObject({ code: 'PET_NOT_FOUND' });
        await database.connection
            .update(petMemberships)
            .set({ status: 'INACTIVE' })
            .where(eq(petMemberships.id, collaboratorMembershipId));
        const inactive = await request(application.getHttpServer())
            .post(path())
            .set('Authorization', `Bearer ${collaborator.token}`)
            .send(body())
            .expect(404);

        expect(inactive.body).toMatchObject({ code: 'PET_NOT_FOUND' });
        await database.connection
            .update(pets)
            .set({ status: 'ARCHIVED' })
            .where(eq(pets.id, petId));
        const archived = await request(application.getHttpServer())
            .post(path())
            .set('Authorization', `Bearer ${owner.token}`)
            .send(body())
            .expect(404);

        expect(archived.body).toMatchObject({ code: 'PET_NOT_FOUND' });
        const missing = await request(application.getHttpServer())
            .post(path(randomUUID()))
            .set('Authorization', `Bearer ${owner.token}`)
            .send(body())
            .expect(404);

        expect(missing.body).toMatchObject({ code: 'PET_NOT_FOUND' });
        expect(
            await database.connection
                .select()
                .from(healthPetAllergies)
                .where(eq(healthPetAllergies.petId, petId)),
        ).toHaveLength(0);
    });
});
