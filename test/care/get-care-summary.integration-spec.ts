import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import {
    GetCareSummary,
    PetNotFoundError,
    type CareSummary,
} from '../../src/care/application/get-care-summary/get-care-summary';
import {
    careRoutines,
    careActivities,
} from '../../src/care/infrastructure/persistence/drizzle/care.schema';
import { accounts } from '../../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../../src/infrastructure/database/database.service';
import {
    petMemberships,
    pets,
} from '../../src/pet-management/infrastructure/persistence/drizzle/pet-management.schema';

interface Barrier {
    promise: Promise<void>;
    release: () => void;
}
function barrier(): Barrier {
    let release: () => void = (): void => {
        throw new Error('Barrier is not initialized');
    };
    const promise: Promise<void> = new Promise<void>((resolve) => {
        release = resolve;
    });

    return { promise, release };
}

interface SettledAction {
    value?: unknown;
    error?: unknown;
}
async function settle(action: Promise<unknown>): Promise<SettledAction> {
    try {
        return { value: await action };
    } catch (error: unknown) {
        return { error };
    }
}

describe('GetCareSummary with PostgreSQL (integration)', () => {
    let application: INestApplicationContext;
    let database: DatabaseService;
    let getCareSummary: GetCareSummary;
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
        getCareSummary = application.get(GetCareSummary);
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
                name: 'Care routine pet',
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
            .delete(careActivities)
            .where(inArray(careActivities.petId, [petId, otherPetId]));
        await database.connection
            .delete(careRoutines)
            .where(inArray(careRoutines.petId, [petId, otherPetId]));
        await database.connection
            .delete(petMemberships)
            .where(inArray(petMemberships.petId, [petId, otherPetId]));
        await database.connection.delete(pets).where(inArray(pets.id, [petId, otherPetId]));
        await database.connection
            .delete(accounts)
            .where(inArray(accounts.id, [ownerId, collaboratorId, outsiderId]));
    });

    async function routine(period: string = 'DAILY', weekdays: string[] = []): Promise<string> {
        const id: string = randomUUID();

        await database.connection.insert(careRoutines).values({
            id,
            petId,
            type: 'WALK',
            title: 'Walk',
            frequencyPeriod: period,
            timesPerPeriod: 5,
            weekdays,
            timezone: 'America/New_York',
            recordedByAccountId: ownerId,
            createdAt: new Date('2026-03-02T04:59:59Z'),
        });

        return id;
    }

    async function activity(
        routineId: string,
        completedAt: string,
        timezone: string = 'America/New_York',
    ): Promise<void> {
        await database.connection.insert(careActivities).values({
            id: randomUUID(),
            petId,
            routineId,
            completedAt: new Date(completedAt),
            timezone,
            completedBy: collaboratorId,
        });
    }

    function summary(accountId: string = ownerId, routineId?: string): Promise<CareSummary> {
        return getCareSummary.execute({
            petId,
            authenticatedAccountId: accountId,
            routineId,
            from: '2026-03-08',
            to: '2026-03-08',
        });
    }

    it.each(['ACTIVE', 'ARCHIVED'] as const)(
        'reads %s pets using activity local days at DST boundaries',
        async (status): Promise<void> => {
            const routineId: string = await routine();

            await activity(routineId, '2026-03-08T04:59:59Z');
            await activity(routineId, '2026-03-08T05:00:00Z');
            await activity(routineId, '2026-03-09T03:59:59.999Z');
            await activity(routineId, '2026-03-09T04:00:00Z');
            await activity(routineId, '2026-03-08T04:59:59Z', 'UTC');
            await database.connection.update(pets).set({ status }).where(eq(pets.id, petId));

            for (const accountId of [ownerId, collaboratorId]) {
                await expect(summary(accountId, routineId)).resolves.toEqual({
                    nextCursor: null,
                    items: [
                        {
                            routineId,
                            timezone: 'America/New_York',
                            weeks: [],
                            days: [
                                { localDay: '2026-03-08', expected: 5, completed: 3, missed: 2 },
                            ],
                        },
                    ],
                });
            }
        },
    );

    it('includes whole overlapping weeks, creation week zero and current routine timezone', async (): Promise<void> => {
        const routineId: string = await routine('WEEKLY');

        await activity(routineId, '2026-03-02T12:00:00Z');
        await activity(routineId, '2026-03-08T12:00:00Z');
        await expect(summary(ownerId, routineId)).resolves.toEqual({
            nextCursor: null,
            items: [
                {
                    routineId,
                    timezone: 'America/New_York',
                    days: [],
                    weeks: [{ weekStart: '2026-03-02', expected: 5, completed: 2, missed: 3 }],
                },
            ],
        });
        await database.connection
            .update(careRoutines)
            .set({ timezone: 'UTC' })
            .where(eq(careRoutines.id, routineId));
        const result: CareSummary = await summary(ownerId, routineId);

        expect(result.items[0].weeks[0].expected).toBe(0);
    });

    it('allocates weekly remainder Monday first using current frequency', async (): Promise<void> => {
        const routineId: string = await routine('WEEKLY', ['SUNDAY', 'MONDAY', 'WEDNESDAY']);
        const result: CareSummary = await getCareSummary.execute({
            petId,
            authenticatedAccountId: ownerId,
            routineId,
            from: '2026-03-02',
            to: '2026-03-08',
        });

        expect(result.items[0].days.map((day): number => day.expected)).toEqual([
            2, 0, 2, 0, 0, 0, 1,
        ]);
    });

    it('authorizes even empty filters and hides outsiders, missing pets and revoked members', async (): Promise<void> => {
        await expect(summary()).resolves.toEqual({ items: [], nextCursor: null });
        await routine();
        await expect(summary(ownerId, randomUUID())).resolves.toEqual({
            items: [],
            nextCursor: null,
        });
        await expect(summary(outsiderId, randomUUID())).rejects.toThrow(PetNotFoundError);
        await database.connection
            .update(petMemberships)
            .set({ status: 'INACTIVE' })
            .where(eq(petMemberships.id, collaboratorMembershipId));
        await expect(summary(collaboratorId)).rejects.toThrow(PetNotFoundError);
        await expect(
            getCareSummary.execute({
                petId: randomUUID(),
                authenticatedAccountId: ownerId,
                from: '2026-03-08',
                to: '2026-03-08',
            }),
        ).rejects.toThrow(PetNotFoundError);
    });

    it('paginates routines beyond 20, retains SQL microsecond ordering and checks access on continuations', async (): Promise<void> => {
        const ids: string[] = [];

        for (let index: number = 0; index < 22; index += 1) {
            ids.push(await routine());
        }

        await database.connection
            .update(careRoutines)
            .set({ createdAt: sql`'2026-03-02T04:59:59.000001Z'::timestamptz` })
            .where(eq(careRoutines.id, ids[0]));
        const first = await summary();
        const second = await getCareSummary.execute({
            petId,
            authenticatedAccountId: ownerId,
            from: '2026-03-08',
            to: '2026-03-08',
            cursor: first.nextCursor,
        });

        expect(first.items).toHaveLength(20);
        expect(first.items[0].routineId).toBe(ids[0]);
        expect(second.items).toHaveLength(2);
        expect(second.nextCursor).toBeNull();
        expect(
            new Set([...first.items, ...second.items].map((item): string => item.routineId)).size,
        ).toBe(22);
    });

    it('does not change records or technical timestamps', async (): Promise<void> => {
        const routineId: string = await routine();

        await activity(routineId, '2026-03-08T12:00:00Z');
        const snapshot = async () => ({
            routines: await database.connection
                .select()
                .from(careRoutines)
                .where(eq(careRoutines.petId, petId)),
            activities: await database.connection
                .select()
                .from(careActivities)
                .where(eq(careActivities.petId, petId)),
            pets: await database.connection.select().from(pets).where(eq(pets.id, petId)),
            memberships: await database.connection
                .select()
                .from(petMemberships)
                .where(eq(petMemberships.petId, petId)),
        });
        const before = await snapshot();

        await summary();
        expect(await snapshot()).toEqual(before);
    });
    it('scopes routine filters to the pet and retains empty access sentinels on exhausted pages', async (): Promise<void> => {
        const otherRoutineId: string = randomUUID();

        await database.connection.insert(careRoutines).values({
            id: otherRoutineId,
            petId: otherPetId,
            type: 'WALK',
            title: 'Other pet',
            frequencyPeriod: 'DAILY',
            timesPerPeriod: 1,
            timezone: 'UTC',
            recordedByAccountId: ownerId,
        });
        await expect(summary(ownerId, otherRoutineId)).resolves.toEqual({
            items: [],
            nextCursor: null,
        });
        await expect(summary(outsiderId, otherRoutineId)).rejects.toThrow(PetNotFoundError);
    });

    it('reads a consistent snapshot without waiting for Pet, Membership or Routine locks', async (): Promise<void> => {
        const routineId: string = await routine();
        const original: CareSummary = await summary();
        const acquired: Barrier = barrier();
        const released: Barrier = barrier();
        const writer: Promise<SettledAction> = settle(
            database.connection.transaction(async (transaction): Promise<void> => {
                await transaction.execute(sql`SET LOCAL statement_timeout = '5000ms'`);
                await transaction.select().from(pets).where(eq(pets.id, petId)).for('update');
                await transaction
                    .select()
                    .from(petMemberships)
                    .where(eq(petMemberships.petId, petId))
                    .for('update');
                await transaction
                    .select()
                    .from(careRoutines)
                    .where(eq(careRoutines.id, routineId))
                    .for('update');
                await transaction
                    .update(careRoutines)
                    .set({ timesPerPeriod: 9 })
                    .where(eq(careRoutines.id, routineId));
                acquired.release();
                await released.promise;
            }),
        );
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let reading: Promise<SettledAction> | undefined;

        try {
            await Promise.race([
                acquired.promise,
                writer.then((result): never => {
                    throw new Error('Writer ended before locking', { cause: result.error });
                }),
            ]);
            reading = settle(summary());
            const result: SettledAction = await Promise.race([
                reading,
                new Promise<never>((_, reject) => {
                    timeout = setTimeout(() => reject(new Error('Read waited for locks')), 2000);
                }),
            ]);

            expect(result.error).toBeUndefined();
            expect(result.value).toEqual(original);
        } finally {
            if (timeout !== undefined) {
                clearTimeout(timeout);
            }

            released.release();
            await writer;

            if (reading !== undefined) {
                await reading;
            }
        }

        expect((await writer).error).toBeUndefined();
        expect((await summary()).items[0].days[0].expected).toBe(9);
    });
});
