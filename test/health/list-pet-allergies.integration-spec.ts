import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import {
    ListPetAllergies,
    PetNotFoundError,
    type PetAllergies,
} from '../../src/health/application/list-pet-allergies/list-pet-allergies';
import type { PetAllergyListItem } from '../../src/health/application/persistence/pet-allergy.reader';
import { RecordPetAllergy } from '../../src/health/application/record-pet-allergy/record-pet-allergy';
import { healthPetAllergies } from '../../src/health/infrastructure/persistence/drizzle/health.schema';
import { accounts } from '../../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../../src/infrastructure/database/database.service';
import { ArchivePet } from '../../src/pet-management/application/archive-pet/archive-pet';
import { LeavePet } from '../../src/pet-management/application/leave-pet/leave-pet';
import { RemovePetMember } from '../../src/pet-management/application/remove-pet-member/remove-pet-member';
import { RestorePet } from '../../src/pet-management/application/restore-pet/restore-pet';
import {
    petMemberships,
    pets,
} from '../../src/pet-management/infrastructure/persistence/drizzle/pet-management.schema';

interface AllergyFixtureInput {
    readonly id?: string;
    readonly petId?: string;
    readonly allergen?: string;
    readonly category?: PetAllergyListItem['category'];
    readonly severity?: PetAllergyListItem['severity'];
    readonly notes?: string | null;
    readonly recordedByAccountId?: string;
    readonly createdAt?: string;
}

const HIGH_ID: string = '10000000-0000-4000-8000-000000000004';
const MIDDLE_ID: string = '10000000-0000-4000-8000-000000000003';
const LOW_ID: string = '10000000-0000-4000-8000-000000000002';
const LOWEST_ID: string = '10000000-0000-4000-8000-000000000001';

describe('ListPetAllergies with PostgreSQL (integration)', () => {
    let application: INestApplicationContext;
    let database: DatabaseService;
    let listPetAllergies: ListPetAllergies;
    let petId: string;
    let otherPetId: string;
    let ownerId: string;
    let collaboratorId: string;
    let outsiderId: string;
    let collaboratorMembershipId: string;

    beforeAll(async (): Promise<void> => {
        const fixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        application = fixture;
        database = application.get(DatabaseService);
        listPetAllergies = application.get(ListPetAllergies);
    });

    afterAll(async (): Promise<void> => {
        await application.close();
    });

    beforeEach(async (): Promise<void> => {
        petId = randomUUID();
        otherPetId = randomUUID();
        ownerId = randomUUID();
        collaboratorId = randomUUID();
        outsiderId = randomUUID();
        collaboratorMembershipId = randomUUID();
        await database.connection.insert(accounts).values(
            [ownerId, collaboratorId, outsiderId].map((accountId: string) => ({
                id: accountId,
                email: `${accountId}@example.com`,
                passwordHash: 'test-hash',
            })),
        );
        await database.connection.insert(pets).values(
            [petId, otherPetId].map((fixturePetId: string) => ({
                id: fixturePetId,
                name: 'Allergy pet',
                species: 'DOG' as const,
                breedName: 'Mixed',
                breedKind: 'CUSTOM' as const,
                sex: 'UNKNOWN' as const,
                birthDate: '2020-01-01',
                birthDateAccuracy: 'EXACT' as const,
                status: 'ACTIVE' as const,
            })),
        );
        await database.connection.insert(petMemberships).values([
            {
                id: randomUUID(),
                petId,
                accountId: ownerId,
                role: 'OWNER',
                status: 'ACTIVE',
            },
            {
                id: collaboratorMembershipId,
                petId,
                accountId: collaboratorId,
                role: 'COLLABORATOR',
                status: 'ACTIVE',
            },
            {
                id: randomUUID(),
                petId: otherPetId,
                accountId: ownerId,
                role: 'OWNER',
                status: 'ACTIVE',
            },
        ]);
    });

    afterEach(async (): Promise<void> => {
        await database.connection
            .delete(healthPetAllergies)
            .where(inArray(healthPetAllergies.petId, [petId, otherPetId]));
        await database.connection
            .delete(petMemberships)
            .where(inArray(petMemberships.petId, [petId, otherPetId]));
        await database.connection.delete(pets).where(inArray(pets.id, [petId, otherPetId]));
        await database.connection
            .delete(accounts)
            .where(inArray(accounts.id, [ownerId, collaboratorId, outsiderId]));
    });

    async function insertAllergy(input: AllergyFixtureInput = {}): Promise<PetAllergyListItem> {
        const item: PetAllergyListItem = {
            id: input.id ?? randomUUID(),
            allergen: input.allergen ?? 'Penicillin',
            category: input.category ?? 'MEDICATION',
            severity: input.severity ?? 'SEVERE',
            notes: input.notes ?? null,
            recordedByAccountId: input.recordedByAccountId ?? ownerId,
        };
        const createdAt: string = input.createdAt ?? '2026-10-01T12:00:00.123456Z';

        await database.connection.insert(healthPetAllergies).values({
            ...item,
            petId: input.petId ?? petId,
            createdAt: sql`${createdAt}::timestamptz`,
        });

        return item;
    }

    function list(
        accountId: string = ownerId,
        requestedPetId: string = petId,
    ): Promise<PetAllergies> {
        return listPetAllergies.execute({
            petId: requestedPetId,
            authenticatedAccountId: accountId,
        });
    }

    it.each([
        { status: 'ACTIVE', role: 'OWNER' },
        { status: 'ACTIVE', role: 'COLLABORATOR' },
        { status: 'ARCHIVED', role: 'OWNER' },
        { status: 'ARCHIVED', role: 'COLLABORATOR' },
    ] as const)(
        'returns items for an $status pet and active $role',
        async ({ status, role }): Promise<void> => {
            const item: PetAllergyListItem = await insertAllergy({
                notes: 'Reported reaction.',
            });

            await database.connection.update(pets).set({ status }).where(eq(pets.id, petId));
            const accountId: string = role === 'OWNER' ? ownerId : collaboratorId;

            await expect(list(accountId)).resolves.toEqual({ items: [item] });
        },
    );

    it.each(['ACTIVE', 'ARCHIVED'] as const)(
        'returns an empty collection for an accessible %s pet',
        async (status): Promise<void> => {
            await database.connection.update(pets).set({ status }).where(eq(pets.id, petId));

            for (const accountId of [ownerId, collaboratorId]) {
                await expect(list(accountId)).resolves.toEqual({ items: [] });
            }
        },
    );

    it.each(['ACTIVE', 'ARCHIVED'] as const)(
        'hides an %s pet from inactive authors and outsiders',
        async (status): Promise<void> => {
            await insertAllergy();
            await insertAllergy({ recordedByAccountId: collaboratorId });
            await database.connection.update(pets).set({ status }).where(eq(pets.id, petId));

            for (const accountId of [ownerId, collaboratorId]) {
                await database.connection
                    .update(petMemberships)
                    .set({ status: 'INACTIVE' })
                    .where(
                        and(
                            eq(petMemberships.petId, petId),
                            eq(petMemberships.accountId, accountId),
                        ),
                    );
                await expect(list(accountId)).rejects.toThrow(PetNotFoundError);
            }

            await expect(list(outsiderId)).rejects.toThrow(PetNotFoundError);
            await expect(list(ownerId, randomUUID())).rejects.toThrow(PetNotFoundError);
        },
    );

    it('orders technical timestamps at microsecond precision and tied UUIDs without crossing pets', async (): Promise<void> => {
        const oldest: PetAllergyListItem = await insertAllergy({
            id: HIGH_ID,
            category: 'OTHER',
            severity: 'UNKNOWN',
            createdAt: '2026-09-30T12:00:00.123456Z',
        });
        const tiedLow: PetAllergyListItem = await insertAllergy({
            id: LOW_ID,
            category: 'FOOD',
            severity: 'MILD',
            notes: 'Food reaction.',
        });
        const newest: PetAllergyListItem = await insertAllergy({
            id: LOWEST_ID,
            category: 'ENVIRONMENTAL',
            severity: 'MODERATE',
            recordedByAccountId: collaboratorId,
            createdAt: '2026-10-01T12:00:00.123457Z',
        });
        const tiedHigh: PetAllergyListItem = await insertAllergy({ id: MIDDLE_ID });

        await insertAllergy({
            petId: otherPetId,
            createdAt: '2026-10-02T12:00:00Z',
        });
        await expect(list()).resolves.toEqual({
            items: [newest, tiedHigh, tiedLow, oldest],
        });
    });

    it('returns duplicates independently and never applies a hidden page limit', async (): Promise<void> => {
        const items: PetAllergyListItem[] = [];

        for (let itemIndex: number = 0; itemIndex < 25; itemIndex += 1) {
            items.push(await insertAllergy());
        }

        items.sort((firstItem: PetAllergyListItem, secondItem: PetAllergyListItem): number =>
            secondItem.id.localeCompare(firstItem.id),
        );
        await expect(list()).resolves.toEqual({ items });
    });

    it('preserves the read result through real Archive and Restore use cases', async (): Promise<void> => {
        await application.get(RecordPetAllergy).execute({
            petId,
            authenticatedAccountId: ownerId,
            allergen: 'Chicken',
            category: 'FOOD',
            severity: 'UNKNOWN',
        });
        const original: PetAllergies = await list();

        await application.get(ArchivePet).execute({ petId, requesterAccountId: ownerId });
        await expect(list()).resolves.toEqual(original);
        await expect(list(collaboratorId)).resolves.toEqual(original);
        await application.get(RestorePet).execute({ petId, requesterAccountId: ownerId });
        await expect(list()).resolves.toEqual(original);
    });

    it.each(['leave', 'remove'] as const)(
        'revokes an author access after %s while preserving allergies for the owner',
        async (action): Promise<void> => {
            await insertAllergy({ recordedByAccountId: collaboratorId });
            const original: PetAllergies = await list(collaboratorId);

            if (action === 'leave') {
                await application.get(LeavePet).execute(petId, collaboratorId);
            } else {
                await application.get(RemovePetMember).execute({
                    petId,
                    requesterAccountId: ownerId,
                    targetMembershipId: collaboratorMembershipId,
                });
            }

            await expect(list(collaboratorId)).rejects.toThrow(PetNotFoundError);
            await expect(list()).resolves.toEqual(original);
        },
    );

    it('has only the primary key and a simple non-unique pet index', async (): Promise<void> => {
        const rows = await database.connection.execute(
            sql`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'health_pet_allergies' ORDER BY indexname`,
        );

        expect(rows.map((row): unknown => row.indexname)).toEqual([
            'health_pet_allergies_pet_idx',
            'health_pet_allergies_pkey',
        ]);
        expect(rows[0]?.indexdef).toContain('USING btree (pet_id)');
        expect(rows[0]?.indexdef).not.toContain('UNIQUE');
    });
});
