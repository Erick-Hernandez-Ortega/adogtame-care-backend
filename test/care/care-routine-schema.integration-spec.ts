import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { careRoutines } from '../../src/care/infrastructure/persistence/drizzle/care.schema';
import { accounts } from '../../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../../src/infrastructure/database/database.service';
import { pets } from '../../src/pet-management/infrastructure/persistence/drizzle/pet-management.schema';

describe('Care routine schema with PostgreSQL (integration)', () => {
    let application: INestApplicationContext;
    let database: DatabaseService;
    let petId: string;
    let accountId: string;

    beforeAll(async () => {
        const fixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        application = fixture;
        database = application.get(DatabaseService);
    });

    afterAll(async () => {
        await application.close();
    });

    beforeEach(async () => {
        petId = randomUUID();
        accountId = randomUUID();
        await database.connection.insert(accounts).values({
            id: accountId,
            email: `${accountId}@example.com`,
            passwordHash: 'test-hash',
        });
        await database.connection.insert(pets).values({
            id: petId,
            name: 'Care pet',
            species: 'DOG',
            breedName: 'Mixed',
            breedKind: 'CUSTOM',
            sex: 'UNKNOWN',
            birthDate: '2020-01-01',
            birthDateAccuracy: 'EXACT',
            status: 'ACTIVE',
        });
    });

    afterEach(async () => {
        await database.connection.delete(careRoutines).where(eq(careRoutines.petId, petId));
        await database.connection.delete(pets).where(eq(pets.id, petId));
        await database.connection.delete(accounts).where(eq(accounts.id, accountId));
    });

    function input(): typeof careRoutines.$inferInsert {
        return {
            id: randomUUID(),
            petId,
            type: 'FEEDING',
            title: 'Morning feeding',
            frequencyPeriod: 'DAILY',
            timesPerPeriod: 2,
            timezone: 'America/Mexico_City',
            recordedByAccountId: accountId,
        };
    }

    it('stores independent routines with defaults and equal technical timestamps', async () => {
        const first = await database.connection.insert(careRoutines).values(input()).returning();
        const second = await database.connection.insert(careRoutines).values(input()).returning();

        expect(first[0]).toMatchObject({
            petId,
            type: 'FEEDING',
            title: 'Morning feeding',
            instructions: null,
            frequencyPeriod: 'DAILY',
            timesPerPeriod: 2,
            suggestedTimes: [],
            weekdays: [],
            timezone: 'America/Mexico_City',
            recordedByAccountId: accountId,
        });
        expect(first[0].createdAt).toEqual(first[0].updatedAt);
        expect(second[0].id).not.toBe(first[0].id);
    });

    it('round-trips weekly wall-clock suggestions, Unicode text and safe integer targets', async () => {
        const values: typeof careRoutines.$inferInsert = {
            ...input(),
            type: 'WALK',
            title: '🐕'.repeat(255),
            instructions: '🐕'.repeat(2000),
            frequencyPeriod: 'WEEKLY',
            timesPerPeriod: Number.MAX_SAFE_INTEGER,
            suggestedTimes: ['00:00', '23:59'],
            weekdays: ['MONDAY', 'SUNDAY'],
        };
        const rows = await database.connection.insert(careRoutines).values(values).returning();

        expect(rows[0]).toMatchObject(values);
    });

    it.each([
        { type: 'MEDICATION' },
        { title: '' },
        { title: ' ' },
        { title: '🐕'.repeat(256) },
        { instructions: '' },
        { instructions: '🐕'.repeat(2001) },
        { frequencyPeriod: 'MONTHLY' },
        { timesPerPeriod: 0 },
        { timesPerPeriod: -1 },
        { timesPerPeriod: Number.MAX_SAFE_INTEGER + 1 },
        { suggestedTimes: ['24:00'] },
        { suggestedTimes: ['08:00,09:00'] },
        { suggestedTimes: ['08:00\n'] },
        { suggestedTimes: ['8:00'] },
        { weekdays: ['MONDAY'] },
        { frequencyPeriod: 'WEEKLY', weekdays: ['FUNDAY'] },
        { timezone: '' },
    ])('rejects invalid persisted data %s', async (invalidValues) => {
        await expect(
            database.connection.insert(careRoutines).values({ ...input(), ...invalidValues }),
        ).rejects.toThrow();
    });

    it('rejects null array entries and multidimensional arrays', async () => {
        const values: typeof careRoutines.$inferInsert = input();

        for (const invalidArray of [sql`ARRAY[NULL]::text[]`, sql`ARRAY[['08:00']]::text[]`]) {
            await expect(
                database.connection.insert(careRoutines).values({
                    ...values,
                    suggestedTimes: invalidArray,
                }),
            ).rejects.toThrow();
        }

        await expect(
            database.connection.insert(careRoutines).values({
                ...values,
                frequencyPeriod: 'WEEKLY',
                weekdays: sql`ARRAY[NULL]::text[]`,
            }),
        ).rejects.toThrow();
    });

    it('enforces identities and restrictive pet and recorder foreign keys', async () => {
        const values: typeof careRoutines.$inferInsert = input();

        await expect(
            database.connection.insert(careRoutines).values({ ...values, petId: randomUUID() }),
        ).rejects.toThrow();
        await expect(
            database.connection
                .insert(careRoutines)
                .values({ ...values, recordedByAccountId: randomUUID() }),
        ).rejects.toThrow();
        await database.connection.insert(careRoutines).values(values);
        await expect(database.connection.insert(careRoutines).values(values)).rejects.toThrow();
        await expect(database.connection.delete(pets).where(eq(pets.id, petId))).rejects.toThrow();
        await expect(
            database.connection.delete(accounts).where(eq(accounts.id, accountId)),
        ).rejects.toThrow();
    });
});
