import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import {
    ListPetWeightHistory,
    PetNotFoundError,
    type PetWeightHistory,
} from '../../src/health/application/list-pet-weight-history/list-pet-weight-history';
import { healthWeightRecords } from '../../src/health/infrastructure/persistence/drizzle/health.schema';
import { accounts } from '../../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../../src/infrastructure/database/database.service';
import {
    petMemberships,
    pets,
} from '../../src/pet-management/infrastructure/persistence/drizzle/pet-management.schema';

const FIRST_ID = '00000000-0000-4000-8000-000000000004';
const SECOND_ID = '00000000-0000-4000-8000-000000000003';
const THIRD_ID = '00000000-0000-4000-8000-000000000002';
const FOURTH_ID = '00000000-0000-4000-8000-000000000001';

describe('ListPetWeightHistory with PostgreSQL (integration)', () => {
    let application: INestApplicationContext;
    let database: DatabaseService;
    let listPetWeightHistory: ListPetWeightHistory;
    let petId: string;
    let otherPetId: string;
    let ownerId: string;
    let collaboratorId: string;
    let outsiderId: string;

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        application = moduleFixture;
        database = application.get(DatabaseService);
        listPetWeightHistory = application.get(ListPetWeightHistory);
    });

    afterAll(async () => {
        await application.close();
    });

    beforeEach(async () => {
        petId = randomUUID();
        otherPetId = randomUUID();
        ownerId = randomUUID();
        collaboratorId = randomUUID();
        outsiderId = randomUUID();
        await database.connection.insert(accounts).values(
            [ownerId, collaboratorId, outsiderId].map((accountId: string) => ({
                id: accountId,
                email: `${accountId}@example.com`,
                passwordHash: 'test-hash',
            })),
        );
        await database.connection.insert(pets).values(
            [petId, otherPetId].map((id: string) => ({
                id,
                name: 'Health pet',
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
                accountId: ownerId,
                role: 'OWNER',
                status: 'ACTIVE',
            },
            {
                id: randomUUID(),
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

    afterEach(async () => {
        await database.connection
            .delete(healthWeightRecords)
            .where(inArray(healthWeightRecords.petId, [petId, otherPetId]));
        await database.connection
            .delete(petMemberships)
            .where(inArray(petMemberships.petId, [petId, otherPetId]));
        await database.connection.delete(pets).where(inArray(pets.id, [petId, otherPetId]));
        await database.connection
            .delete(accounts)
            .where(inArray(accounts.id, [ownerId, collaboratorId, outsiderId]));
    });

    async function insertRecord(
        id: string,
        measuredDate: string,
        createdAt: string,
        recordPetId: string = petId,
        weightKg = '12.34',
    ): Promise<void> {
        await database.connection.insert(healthWeightRecords).values({
            id,
            petId: recordPetId,
            weightKg,
            measuredDate,
            recordedByAccountId: ownerId,
        });
        await database.connection.execute(
            sql`UPDATE health_weight_records SET created_at = ${createdAt}::timestamptz WHERE id = ${id}::uuid`,
        );
    }

    function list(
        accountId: string = ownerId,
        limit = 20,
        cursor: string | null = null,
        requestedPetId: string = petId,
    ): Promise<PetWeightHistory> {
        return listPetWeightHistory.execute({
            petId: requestedPetId,
            authenticatedAccountId: accountId,
            limit,
            cursor,
        });
    }

    it('returns an empty history for active owner and collaborator and archived members', async () => {
        for (const accountId of [ownerId, collaboratorId]) {
            await expect(list(accountId)).resolves.toEqual({
                items: [],
                nextCursor: null,
            });
        }

        await database.connection
            .update(pets)
            .set({ status: 'ARCHIVED' })
            .where(eq(pets.id, petId));

        for (const accountId of [ownerId, collaboratorId]) {
            await expect(list(accountId)).resolves.toEqual({
                items: [],
                nextCursor: null,
            });
        }
    });

    it('hides inactive owners, inactive collaborators, outsiders, and missing pets, regardless of authorship', async () => {
        await insertRecord(FIRST_ID, '2026-09-26', '2026-09-26T12:00:00.123456Z');

        for (const accountId of [ownerId, collaboratorId]) {
            await database.connection
                .update(petMemberships)
                .set({ status: 'INACTIVE' })
                .where(eq(petMemberships.accountId, accountId));
            await expect(list(accountId)).rejects.toThrow(PetNotFoundError);
        }

        await expect(list(outsiderId)).rejects.toThrow(PetNotFoundError);
        await expect(list(ownerId, 20, null, randomUUID())).rejects.toThrow(PetNotFoundError);
    });

    it('orders by date, microsecond timestamp, and id, and never crosses pets', async () => {
        await insertRecord(FOURTH_ID, '2026-09-25', '2026-09-26T12:00:00.123456Z');
        await insertRecord(SECOND_ID, '2026-09-26', '2026-09-26T12:00:00.123456Z');
        await insertRecord(FIRST_ID, '2026-09-26', '2026-09-26T12:00:00.123457Z');
        await insertRecord(THIRD_ID, '2026-09-26', '2026-09-26T12:00:00.123456Z');
        await insertRecord(randomUUID(), '2026-09-27', '2026-09-27T12:00:00.000000Z', otherPetId);
        const result: PetWeightHistory = await list();

        expect(result.items.map((item) => item.id)).toEqual([
            FIRST_ID,
            SECOND_ID,
            THIRD_ID,
            FOURTH_ID,
        ]);
        expect(result.items[0]).toEqual({
            id: FIRST_ID,
            weightKg: '12.34',
            measuredDate: '2026-09-26',
            recordedByAccountId: ownerId,
        });
        expect(result.nextCursor).toBeNull();
    });

    it('pages without duplicates or skips across microsecond and id ties', async () => {
        await insertRecord(FIRST_ID, '2026-09-26', '2026-09-26T12:00:00.123457Z');
        await insertRecord(SECOND_ID, '2026-09-26', '2026-09-26T12:00:00.123456Z');
        await insertRecord(THIRD_ID, '2026-09-26', '2026-09-26T12:00:00.123456Z');
        await insertRecord(FOURTH_ID, '2026-09-25', '2026-09-26T12:00:00.123456Z');

        const firstPage: PetWeightHistory = await list(ownerId, 1);
        const secondPage: PetWeightHistory = await list(ownerId, 1, firstPage.nextCursor);
        const thirdPage: PetWeightHistory = await list(ownerId, 1, secondPage.nextCursor);
        const lastPage: PetWeightHistory = await list(ownerId, 1, thirdPage.nextCursor);

        expect(
            [firstPage, secondPage, thirdPage, lastPage].flatMap((page) =>
                page.items.map((item) => item.id),
            ),
        ).toEqual([FIRST_ID, SECOND_ID, THIRD_ID, FOURTH_ID]);
        expect(lastPage.nextCursor).toBeNull();
        const twoAtOnce: PetWeightHistory = await list(ownerId, 2);

        expect(twoAtOnce.items.map((item) => item.id)).toEqual([FIRST_ID, SECOND_ID]);
        expect((await list(ownerId, 2, twoAtOnce.nextCursor)).items.map((item) => item.id)).toEqual(
            [THIRD_ID, FOURTH_ID],
        );
    });

    it('uses keyset behavior when new records arrive between pages', async () => {
        await insertRecord(FIRST_ID, '2026-09-26', '2026-09-26T12:00:00.123456Z');
        await insertRecord(THIRD_ID, '2026-09-25', '2026-09-26T12:00:00.123456Z');
        const firstPage: PetWeightHistory = await list(ownerId, 1);

        await insertRecord(SECOND_ID, '2026-09-27', '2026-09-27T12:00:00.123456Z');
        await insertRecord(FOURTH_ID, '2026-09-24', '2026-09-27T12:00:00.123456Z');
        const following: PetWeightHistory = await list(ownerId, 20, firstPage.nextCursor);

        expect(following.items.map((item) => item.id)).toEqual([THIRD_ID, FOURTH_ID]);
    });

    it('supports limit 100 and preserves canonical decimal strings', async () => {
        await insertRecord(FIRST_ID, '2026-09-26', '2026-09-26T12:00:00.123456Z', petId, '12.3456');
        const result: PetWeightHistory = await list(ownerId, 100);

        expect(result.items).toHaveLength(1);
        expect(result.items[0]?.weightKg).toBe('12.3456');
        expect(typeof result.items[0]?.weightKg).toBe('string');
    });

    it('has the migration index matching the descending pagination key', async () => {
        const rows = await database.connection.execute(
            sql`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'health_weight_records' AND indexname = 'health_weight_records_pet_history_idx'`,
        );

        expect(rows[0]?.indexdef).toMatch(
            /\(pet_id, measured_date DESC NULLS LAST, created_at DESC NULLS LAST, id DESC NULLS LAST\)/,
        );
    });
});
