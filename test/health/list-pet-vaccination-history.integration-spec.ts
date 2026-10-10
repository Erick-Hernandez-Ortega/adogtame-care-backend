import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import {
    ListPetVaccinationHistory,
    PetNotFoundError,
    type PetVaccinationHistory,
} from '../../src/health/application/list-pet-vaccination-history/list-pet-vaccination-history';
import { InvalidVaccinationHistoryCursorError } from '../../src/health/application/list-pet-vaccination-history/vaccination-history-cursor';
import { healthVaccinationRecords } from '../../src/health/infrastructure/persistence/drizzle/health.schema';
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

describe('ListPetVaccinationHistory with PostgreSQL (integration)', () => {
    let application: INestApplicationContext;
    let database: DatabaseService;
    let history: ListPetVaccinationHistory;
    let petId: string;
    let otherPetId: string;
    let ownerId: string;
    let collaboratorId: string;
    let outsiderId: string;

    beforeAll(async () => {
        const fixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        application = fixture;
        database = application.get(DatabaseService);
        history = application.get(ListPetVaccinationHistory);
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
            [ownerId, collaboratorId, outsiderId].map((accountId) => ({
                id: accountId,
                email: `${accountId}@example.com`,
                passwordHash: 'test-hash',
            })),
        );
        await database.connection.insert(pets).values(
            [petId, otherPetId].map((id) => ({
                id,
                name: 'Vaccination pet',
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
            .delete(healthVaccinationRecords)
            .where(inArray(healthVaccinationRecords.petId, [petId, otherPetId]));
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
        appliedDate: string,
        createdAt: string,
        recordPetId: string = petId,
        nextDueDate: string | null = null,
    ): Promise<void> {
        await database.connection.insert(healthVaccinationRecords).values({
            id,
            petId: recordPetId,
            vaccineName: 'Rabies',
            appliedDate,
            nextDueDate,
            recordedByAccountId: ownerId,
        });
        await database.connection.execute(
            sql`UPDATE health_vaccination_records SET created_at = ${createdAt}::timestamptz WHERE id = ${id}::uuid`,
        );
    }

    function list(
        accountId: string = ownerId,
        limit = 20,
        cursor: string | null = null,
        requestedPetId: string = petId,
    ): Promise<PetVaccinationHistory> {
        return history.execute({
            petId: requestedPetId,
            authenticatedAccountId: accountId,
            limit,
            cursor,
        });
    }

    it('returns empty history for both roles and archived pets', async () => {
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

        await insertRecord(FIRST_ID, '2026-09-20', '2026-09-26T12:00:00.123456Z');

        for (const accountId of [ownerId, collaboratorId]) {
            expect((await list(accountId)).items.map((item) => item.id)).toEqual([FIRST_ID]);
        }
    });

    it('hides inactive members, outsiders, and missing pets regardless of authorship', async () => {
        await insertRecord(FIRST_ID, '2026-09-20', '2026-09-26T12:00:00.123456Z');

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

    it('orders by applied date, microsecond timestamp, and id without crossing pets', async () => {
        await insertRecord(FOURTH_ID, '2026-09-19', '2026-09-26T12:00:00.123456Z');
        await insertRecord(
            SECOND_ID,
            '2026-09-20',
            '2026-09-26T12:00:00.123456Z',
            petId,
            '2027-09-20',
        );
        await insertRecord(FIRST_ID, '2026-09-20', '2026-09-26T12:00:00.123457Z');
        await insertRecord(THIRD_ID, '2026-09-20', '2026-09-26T12:00:00.123456Z');
        await insertRecord(randomUUID(), '2026-09-21', '2026-09-27T12:00:00.000000Z', otherPetId);
        const result: PetVaccinationHistory = await list();

        expect(result.items.map((item) => item.id)).toEqual([
            FIRST_ID,
            SECOND_ID,
            THIRD_ID,
            FOURTH_ID,
        ]);
        expect(result.items[0]).toEqual({
            id: FIRST_ID,
            vaccineName: 'Rabies',
            appliedDate: '2026-09-20',
            nextDueDate: null,
            recordedByAccountId: ownerId,
        });
        expect(result.items[1]?.nextDueDate).toBe('2027-09-20');
    });

    it('paginates exact duplicates without skips across microseconds and id ties', async () => {
        await insertRecord(FIRST_ID, '2026-09-20', '2026-09-26T12:00:00.123457Z');
        await insertRecord(SECOND_ID, '2026-09-20', '2026-09-26T12:00:00.123456Z');
        await insertRecord(THIRD_ID, '2026-09-20', '2026-09-26T12:00:00.123456Z');
        await insertRecord(FOURTH_ID, '2026-09-19', '2026-09-26T12:00:00.123456Z');
        const pages: PetVaccinationHistory[] = [];
        let cursor: string | null = null;

        for (let pageIndex = 0; pageIndex < 4; pageIndex += 1) {
            const page: PetVaccinationHistory = await list(ownerId, 1, cursor);

            pages.push(page);
            cursor = page.nextCursor;
        }

        expect(pages.flatMap((page) => page.items.map((item) => item.id))).toEqual([
            FIRST_ID,
            SECOND_ID,
            THIRD_ID,
            FOURTH_ID,
        ]);
        expect(pages[3]?.nextCursor).toBeNull();
        const twoAtOnce = await list(ownerId, 2);

        expect(twoAtOnce.items.map((item) => item.id)).toEqual([FIRST_ID, SECOND_ID]);
        expect((await list(ownerId, 2, twoAtOnce.nextCursor)).items.map((item) => item.id)).toEqual(
            [THIRD_ID, FOURTH_ID],
        );
    });

    it('uses a deleted cursor row as a position and binds cursors to a pet', async () => {
        await insertRecord(FIRST_ID, '2026-09-20', '2026-09-26T12:00:00.123457Z');
        await insertRecord(SECOND_ID, '2026-09-19', '2026-09-26T12:00:00.123456Z');
        const firstPage = await list(ownerId, 1);

        await database.connection
            .delete(healthVaccinationRecords)
            .where(eq(healthVaccinationRecords.id, FIRST_ID));
        expect((await list(ownerId, 1, firstPage.nextCursor)).items.map((item) => item.id)).toEqual(
            [SECOND_ID],
        );
        await expect(list(ownerId, 1, firstPage.nextCursor, otherPetId)).rejects.toThrow(
            InvalidVaccinationHistoryCursorError,
        );
        await expect(list(ownerId, 1, 'bad!')).rejects.toThrow(
            InvalidVaccinationHistoryCursorError,
        );
    });

    it('rechecks access and allows archive between pages', async () => {
        await insertRecord(FIRST_ID, '2026-09-20', '2026-09-26T12:00:00.123457Z');
        await insertRecord(SECOND_ID, '2026-09-19', '2026-09-26T12:00:00.123456Z');
        const firstPage = await list(collaboratorId, 1);

        await database.connection
            .update(pets)
            .set({ status: 'ARCHIVED' })
            .where(eq(pets.id, petId));
        expect(
            (await list(collaboratorId, 1, firstPage.nextCursor)).items.map((item) => item.id),
        ).toEqual([SECOND_ID]);
        await database.connection
            .update(petMemberships)
            .set({ status: 'INACTIVE' })
            .where(eq(petMemberships.accountId, collaboratorId));
        await expect(list(collaboratorId, 1, firstPage.nextCursor)).rejects.toThrow(
            PetNotFoundError,
        );
    });

    it('includes later inserts after the cursor and excludes earlier inserts', async () => {
        await insertRecord(FIRST_ID, '2026-09-20', '2026-09-26T12:00:00.123456Z');
        await insertRecord(THIRD_ID, '2026-09-19', '2026-09-26T12:00:00.123456Z');
        const firstPage = await list(ownerId, 1);

        await insertRecord(SECOND_ID, '2026-09-21', '2026-09-27T12:00:00.123456Z');
        await insertRecord(FOURTH_ID, '2026-09-18', '2026-09-27T12:00:00.123456Z');
        expect(
            (await list(ownerId, 20, firstPage.nextCursor)).items.map((item) => item.id),
        ).toEqual([THIRD_ID, FOURTH_ID]);
    });

    it('supports limit 100 and has the exact non-unique descending index', async () => {
        await insertRecord(FIRST_ID, '2026-09-20', '2026-09-26T12:00:00.123456Z');
        expect((await list(ownerId, 100)).items).toHaveLength(1);
        const rows = await database.connection.execute(
            sql`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'health_vaccination_records' AND indexname = 'health_vaccination_records_pet_history_idx'`,
        );

        expect(rows[0]?.indexdef).toMatch(
            /\(pet_id, applied_date DESC NULLS LAST, created_at DESC NULLS LAST, id DESC NULLS LAST\)/,
        );
        expect(rows[0]?.indexdef).not.toContain('UNIQUE');
    });
});
