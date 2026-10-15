import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import {
    ListCareRoutines,
    PetNotFoundError,
    type CareRoutines,
} from '../../src/care/application/list-care-routines/list-care-routines';
import type { CareRoutineListItem } from '../../src/care/application/persistence/care-routine.reader';
import { CreateCareRoutine } from '../../src/care/application/create-care-routine/create-care-routine';
import { careRoutines } from '../../src/care/infrastructure/persistence/drizzle/care.schema';
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

interface CareRoutineFixtureInput {
    readonly id?: string;
    readonly petId?: string;
    readonly instructions?: string | null;
    readonly recordedByAccountId?: string;
    readonly createdAt?: string;
}

const HIGH_ID: string = '10000000-0000-4000-8000-000000000004';
const MIDDLE_ID: string = '10000000-0000-4000-8000-000000000003';
const LOW_ID: string = '10000000-0000-4000-8000-000000000002';
const LOWEST_ID: string = '10000000-0000-4000-8000-000000000001';

function storedRoutine(item: CareRoutineListItem) {
    const { frequency, ...properties } = item;

    return {
        ...properties,
        frequencyPeriod: frequency.period,
        timesPerPeriod: frequency.timesPerPeriod,
        suggestedTimes: [...frequency.suggestedTimes],
        weekdays: [...frequency.weekdays],
    };
}

describe('ListCareRoutines with PostgreSQL (integration)', () => {
    let application: INestApplicationContext;
    let database: DatabaseService;
    let listCareRoutines: ListCareRoutines;
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
        listCareRoutines = application.get(ListCareRoutines);
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

    async function insertRoutine(
        input: CareRoutineFixtureInput = {},
    ): Promise<CareRoutineListItem> {
        const item: CareRoutineListItem = {
            id: input.id ?? randomUUID(),
            type: 'FEEDING',
            title: 'Breakfast',
            instructions: input.instructions ?? null,
            frequency: {
                period: 'DAILY',
                timesPerPeriod: 1,
                suggestedTimes: ['08:00', '08:00'],
                weekdays: [],
            },
            timezone: 'America/Mexico_City',
            recordedByAccountId: input.recordedByAccountId ?? ownerId,
        };
        const createdAt: string = input.createdAt ?? '2026-10-01T12:00:00.123456Z';

        await database.connection.insert(careRoutines).values({
            ...storedRoutine(item),
            petId: input.petId ?? petId,
            createdAt: sql`${createdAt}::timestamptz`,
        });

        return item;
    }

    function list(
        accountId: string = ownerId,
        requestedPetId: string = petId,
    ): Promise<CareRoutines> {
        return listCareRoutines.execute({
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
            const item: CareRoutineListItem = await insertRoutine({
                instructions: 'Give one portion.',
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
            await insertRoutine();
            await insertRoutine({ recordedByAccountId: collaboratorId });
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

    it('orders microsecond timestamps and UUIDs descending', async (): Promise<void> => {
        const oldestRoutine: CareRoutineListItem = await insertRoutine({
            id: HIGH_ID,
            createdAt: '2026-09-30T12:00:00Z',
        });
        const tiedLow: CareRoutineListItem = await insertRoutine({
            id: LOW_ID,
        });
        const newestTimestamp: CareRoutineListItem = await insertRoutine({
            id: LOWEST_ID,
            recordedByAccountId: collaboratorId,
            createdAt: '2026-10-01T12:00:00.123457Z',
        });
        const tiedHigh: CareRoutineListItem = await insertRoutine({
            id: MIDDLE_ID,
        });

        await insertRoutine({ petId: otherPetId });
        await expect(list()).resolves.toEqual({
            items: [newestTimestamp, tiedHigh, tiedLow, oldestRoutine],
        });
    });

    it('returns duplicates independently and never applies a hidden page limit', async (): Promise<void> => {
        const items: CareRoutineListItem[] = [];

        for (let itemIndex: number = 0; itemIndex < 25; itemIndex += 1) {
            items.push(await insertRoutine());
        }

        items.sort((firstItem: CareRoutineListItem, secondItem: CareRoutineListItem): number =>
            secondItem.id.localeCompare(firstItem.id),
        );
        await expect(list()).resolves.toEqual({ items });
    });

    it('preserves the read result through real Archive and Restore use cases', async (): Promise<void> => {
        await application.get(CreateCareRoutine).execute({
            petId,
            authenticatedAccountId: ownerId,
            type: 'WALK',
            title: 'Evening walk',
            frequency: {
                period: 'WEEKLY',
                timesPerPeriod: 2,
                suggestedTimes: ['19:00'],
                weekdays: ['MONDAY', 'FRIDAY'],
            },
            timezone: 'America/Mexico_City',
        });
        const original: CareRoutines = await list();

        await application.get(ArchivePet).execute({ petId, requesterAccountId: ownerId });
        await expect(list()).resolves.toEqual(original);
        await expect(list(collaboratorId)).resolves.toEqual(original);
        await application.get(RestorePet).execute({ petId, requesterAccountId: ownerId });
        await expect(list()).resolves.toEqual(original);
    });

    it.each(['leave', 'remove'] as const)(
        'revokes an author access after %s while preserving routines for the owner',
        async (action): Promise<void> => {
            await insertRoutine({ recordedByAccountId: collaboratorId });
            const original: CareRoutines = await list(collaboratorId);

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

    it('reads without waiting for row locks and observes an inserted routine only after commit', async (): Promise<void> => {
        const original: CareRoutineListItem = await insertRoutine();
        const pending: CareRoutineListItem = {
            ...original,
            id: randomUUID(),
        };
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
                    .where(eq(careRoutines.id, original.id))
                    .for('update');
                await transaction.insert(careRoutines).values({
                    ...storedRoutine(pending),
                    petId,
                    createdAt: sql`'2025-01-01T00:00:00Z'::timestamptz`,
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
                writer.then((result: SettledAction): never => {
                    if (result.error instanceof Error) {
                        throw result.error;
                    }

                    throw new Error('Writer ended before acquiring locks', {
                        cause: result.error,
                    });
                }),
            ]);
            reading = settle(list());
            const result: SettledAction = await Promise.race([
                reading,
                new Promise<never>((_, reject) => {
                    timeout = setTimeout(
                        () => reject(new Error('List waited for row locks')),
                        2000,
                    );
                }),
            ]);

            expect(result.error).toBeUndefined();
            expect(result.value).toEqual({ items: [original] });
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
        await expect(list()).resolves.toEqual({ items: [original, pending] });
    });

    it('does not change routine, pet, or membership timestamps', async (): Promise<void> => {
        await insertRoutine();
        const beforeRoutines = await database.connection
            .select()
            .from(careRoutines)
            .where(eq(careRoutines.petId, petId));
        const beforePets = await database.connection.select().from(pets).where(eq(pets.id, petId));
        const beforeMemberships = await database.connection
            .select()
            .from(petMemberships)
            .where(eq(petMemberships.petId, petId));

        await list();
        await list(collaboratorId);

        expect(
            await database.connection
                .select()
                .from(careRoutines)
                .where(eq(careRoutines.petId, petId)),
        ).toEqual(beforeRoutines);
        expect(await database.connection.select().from(pets).where(eq(pets.id, petId))).toEqual(
            beforePets,
        );
        expect(
            await database.connection
                .select()
                .from(petMemberships)
                .where(eq(petMemberships.petId, petId)),
        ).toEqual(beforeMemberships);
    });
});
