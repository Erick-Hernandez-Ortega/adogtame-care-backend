import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import {
    ListCareActivities,
    PetNotFoundError,
    type CareActivities,
} from '../../src/care/application/list-care-activities/list-care-activities';
import type {
    CareActivityListItem,
    CareActivityReadRequest,
} from '../../src/care/application/persistence/care-activity.reader';
import { CreateCareRoutine } from '../../src/care/application/create-care-routine/create-care-routine';
import {
    careRoutines,
    careActivities,
} from '../../src/care/infrastructure/persistence/drizzle/care.schema';
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

describe('ListCareActivities with PostgreSQL (integration)', () => {
    let application: INestApplicationContext;
    let database: DatabaseService;
    let listCareActivities: ListCareActivities;
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
        listCareActivities = application.get(ListCareActivities);
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

    async function routine(requestedPetId: string = petId): Promise<string> {
        const created = await application.get(CreateCareRoutine).execute({
            petId: requestedPetId,
            authenticatedAccountId: ownerId,
            type: 'WALK',
            title: 'Walk',
            frequency: { period: 'DAILY', timesPerPeriod: 1 },
            timezone: 'UTC',
        });

        return created.id;
    }

    interface ActivityFixture {
        readonly id?: string;
        readonly petId?: string;
        readonly routineId?: string;
        readonly completedAt?: string;
        readonly timezone?: string;
        readonly createdAt?: string;
    }

    async function insertActivity(input: ActivityFixture = {}): Promise<string> {
        const requestedPetId: string = input.petId ?? petId;
        const routineId: string = input.routineId ?? (await routine(requestedPetId));
        const id: string = input.id ?? randomUUID();
        const completedAt: string = input.completedAt ?? '2026-10-10T02:00:00Z';
        const createdAt: string = input.createdAt ?? '2026-10-11T12:00:00.123456Z';

        await database.connection.insert(careActivities).values({
            id,
            petId: requestedPetId,
            routineId,
            completedAt: sql`${completedAt}::timestamptz`,
            completedBy: collaboratorId,
            timezone: input.timezone ?? 'America/Mexico_City',
            notes: null,
            createdAt: sql`${createdAt}::timestamptz`,
        });

        return id;
    }

    function list(filters: Partial<CareActivityReadRequest> = {}): Promise<CareActivities> {
        return listCareActivities.execute({
            petId: filters.petId ?? petId,
            authenticatedAccountId: filters.accountId ?? ownerId,
            from: filters.from,
            to: filters.to,
            routineId: filters.routineId,
        });
    }

    it.each([
        { status: 'ACTIVE', account: 'owner' },
        { status: 'ACTIVE', account: 'collaborator' },
        { status: 'ARCHIVED', account: 'owner' },
        { status: 'ARCHIVED', account: 'collaborator' },
    ] as const)(
        'reads exact history for $status pets as $account',
        async ({ status, account }): Promise<void> => {
            const routineId: string = await routine();
            const id: string = await insertActivity({ routineId });

            await insertActivity({ petId: otherPetId });
            await database.connection.update(pets).set({ status }).where(eq(pets.id, petId));
            await expect(
                list({ accountId: account === 'owner' ? ownerId : collaboratorId }),
            ).resolves.toEqual({
                nextCursor: null,
                items: [
                    {
                        id,
                        routineId,
                        completedAt: '2026-10-10T02:00:00.000Z',
                        completedBy: collaboratorId,
                        timezone: 'America/Mexico_City',
                        localDay: '2026-10-09',
                        notes: null,
                    },
                ],
            });
        },
    );

    it('keeps empty history distinct from denied access for every filter', async (): Promise<void> => {
        await expect(list()).resolves.toEqual({ nextCursor: null, items: [] });
        await insertActivity();

        for (const filters of [
            { routineId: randomUUID() },
            { from: '2026-10-10' },
            { to: '2026-10-08' },
        ]) {
            await expect(list(filters)).resolves.toEqual({ nextCursor: null, items: [] });
            await expect(list({ ...filters, accountId: outsiderId })).rejects.toThrow(
                PetNotFoundError,
            );
        }

        await expect(list({ petId: randomUUID() })).rejects.toThrow(PetNotFoundError);
    });

    it('filters inclusive local days across midnight and DST, independently of routine timezone', async (): Promise<void> => {
        const routineId: string = await routine();
        const before: string = await insertActivity({
            routineId,
            completedAt: '2026-03-08T04:59:59Z',
            timezone: 'America/New_York',
        });
        const first: string = await insertActivity({
            routineId,
            completedAt: '2026-03-08T05:00:00Z',
            timezone: 'America/New_York',
        });
        const last: string = await insertActivity({
            routineId,
            completedAt: '2026-03-09T03:59:59.999Z',
            timezone: 'America/New_York',
        });
        const after: string = await insertActivity({
            routineId,
            completedAt: '2026-03-09T04:00:00Z',
            timezone: 'America/New_York',
        });
        const otherRoutineId: string = await routine();

        await insertActivity({ routineId: otherRoutineId, completedAt: '2026-03-08T12:00:00Z' });
        const result: CareActivities = await list({
            from: '2026-03-08',
            to: '2026-03-08',
            routineId,
        });

        expect(result.items.map((item: CareActivityListItem): string => item.id)).toEqual([
            last,
            first,
        ]);
        expect(
            result.items.every(
                (item: CareActivityListItem): boolean => item.localDay === '2026-03-08',
            ),
        ).toBe(true);
        expect(
            (await list({ routineId, to: '2026-03-07' })).items.map((item): string => item.id),
        ).toEqual([before]);
        expect(
            (await list({ routineId, from: '2026-03-09' })).items.map((item): string => item.id),
        ).toEqual([after]);
        await expect(list({ routineId: await routine(otherPetId) })).resolves.toEqual({
            nextCursor: null,
            items: [],
        });
    });

    it('orders by completion, creation microseconds and UUID while retaining independent duplicates', async (): Promise<void> => {
        const routineId: string = await routine();
        const oldest: string = await insertActivity({
            routineId,
            completedAt: '2026-10-09T00:00:00Z',
        });
        const low: string = await insertActivity({
            routineId,
            id: '10000000-0000-4000-8000-000000000001',
        });
        const high: string = await insertActivity({
            routineId,
            id: '10000000-0000-4000-8000-000000000002',
        });
        const microsecond: string = await insertActivity({
            routineId,
            createdAt: '2026-10-11T12:00:00.123457Z',
        });
        const newest: string = await insertActivity({
            routineId,
            completedAt: '2026-10-10T02:00:00.001Z',
        });

        expect((await list()).items.map((item): string => item.id)).toEqual([
            newest,
            microsecond,
            high,
            low,
            oldest,
        ]);

        for (let count: number = 0; count < 21; count += 1) {
            await insertActivity({ routineId });
        }

        const page = await list();

        expect(page.items).toHaveLength(20);
        expect(page.nextCursor).not.toBeNull();
        const continuation = await listCareActivities.execute({
            petId,
            authenticatedAccountId: ownerId,
            cursor: page.nextCursor,
        });

        expect(continuation.items).toHaveLength(6);
        expect(continuation.nextCursor).toBeNull();
        expect(
            new Set([...page.items, ...continuation.items].map((item): string => item.id)).size,
        ).toBe(26);
    });

    it.each(['leave', 'remove'] as const)(
        'revokes recorder access after %s and preserves archived history',
        async (action): Promise<void> => {
            await insertActivity();
            const original: CareActivities = await list();

            if (action === 'leave') {
                await application.get(LeavePet).execute(petId, collaboratorId);
            } else {
                await application.get(RemovePetMember).execute({
                    petId,
                    requesterAccountId: ownerId,
                    targetMembershipId: collaboratorMembershipId,
                });
            }

            await expect(list({ accountId: collaboratorId })).rejects.toThrow(PetNotFoundError);
            await application.get(ArchivePet).execute({ petId, requesterAccountId: ownerId });
            await expect(list()).resolves.toEqual(original);
            await application.get(RestorePet).execute({ petId, requesterAccountId: ownerId });
            await expect(list()).resolves.toEqual(original);
        },
    );

    it('preserves all stored rows and timestamps on reads', async (): Promise<void> => {
        await insertActivity();
        const snapshot = async () => ({
            activities: await database.connection
                .select()
                .from(careActivities)
                .where(eq(careActivities.petId, petId)),
            routines: await database.connection
                .select()
                .from(careRoutines)
                .where(eq(careRoutines.petId, petId)),
            pets: await database.connection.select().from(pets).where(eq(pets.id, petId)),
            memberships: await database.connection
                .select()
                .from(petMemberships)
                .where(eq(petMemberships.petId, petId)),
        });
        const before = await snapshot();

        await list({ from: '2026-10-01', to: '2026-10-31' });
        await list({ accountId: collaboratorId });
        expect(await snapshot()).toEqual(before);
    });

    it('does not wait for Pet, Membership or activity locks and sees new rows only after commit', async (): Promise<void> => {
        const routineId: string = await routine();

        await insertActivity({ routineId });
        const original: CareActivities = await list();
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
                    .from(careActivities)
                    .where(eq(careActivities.petId, petId))
                    .for('update');
                await transaction.insert(careActivities).values({
                    id: randomUUID(),
                    petId,
                    routineId,
                    completedAt: new Date('2026-10-10T12:00:00Z'),
                    completedBy: ownerId,
                    timezone: 'UTC',
                });
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
            reading = settle(list());
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
        expect((await list()).items).toHaveLength(2);
    });
});
