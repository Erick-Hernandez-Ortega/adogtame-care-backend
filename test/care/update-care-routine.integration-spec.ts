import {
    UpdateCareRoutine,
    CareRoutineNotFoundError,
    type UpdateCareRoutineCommand,
} from '../../src/care/application/update-care-routine/update-care-routine';
import { InvalidRoutineTitleError } from '../../src/care/application/create-care-routine/create-care-routine';
import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import {
    CreateCareRoutine,
    PetNotFoundError,
} from '../../src/care/application/create-care-routine/create-care-routine';
import { careRoutines } from '../../src/care/infrastructure/persistence/drizzle/care.schema';
import { accounts } from '../../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../../src/infrastructure/database/database.service';
import {
    petMemberships,
    pets,
} from '../../src/pet-management/infrastructure/persistence/drizzle/pet-management.schema';
import { ArchivePet } from '../../src/pet-management/application/archive-pet/archive-pet';
import { RestorePet } from '../../src/pet-management/application/restore-pet/restore-pet';
import { LeavePet } from '../../src/pet-management/application/leave-pet/leave-pet';
import { RemovePetMember } from '../../src/pet-management/application/remove-pet-member/remove-pet-member';

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

type AccessChange = 'archive' | 'leave' | 'remove';

describe('UpdateCareRoutine with PostgreSQL (integration)', () => {
    let application: INestApplicationContext;
    let database: DatabaseService;
    let createCareRoutine: CreateCareRoutine;
    let petId: string;
    let ownerId: string;
    let collaboratorId: string;
    let outsiderId: string;
    let collaboratorMembershipId: string;

    beforeAll(async () => {
        const fixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        application = fixture;
        database = application.get(DatabaseService);
        createCareRoutine = application.get(CreateCareRoutine);
    });

    afterAll(async () => {
        await application.close();
    });

    beforeEach(async () => {
        petId = randomUUID();
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
        await database.connection.insert(pets).values({
            id: petId,
            name: 'Care routine pet',
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
        ]);
    });

    afterEach(async () => {
        await database.connection.delete(careRoutines).where(eq(careRoutines.petId, petId));
        await database.connection.delete(petMemberships).where(eq(petMemberships.petId, petId));
        await database.connection.delete(pets).where(eq(pets.id, petId));

        for (const accountId of [ownerId, collaboratorId, outsiderId]) {
            await database.connection.delete(accounts).where(eq(accounts.id, accountId));
        }
    });

    function create(accountId: string = ownerId, instructions: string | null = '  One portion  ') {
        return createCareRoutine.execute({
            petId,
            type: 'FEEDING',
            title: '  Breakfast  ',
            instructions,
            frequency: {
                period: 'WEEKLY',
                timesPerPeriod: 3,
                suggestedTimes: ['08:00'],
                weekdays: ['MONDAY'],
            },
            timezone: 'America/Mexico_City',
            authenticatedAccountId: accountId,
        });
    }

    function rows() {
        return database.connection.select().from(careRoutines).where(eq(careRoutines.petId, petId));
    }

    function changeAccess(action: AccessChange): Promise<void> {
        switch (action) {
            case 'archive':
                return application.get(ArchivePet).execute({ petId, requesterAccountId: ownerId });
            case 'leave':
                return application.get(LeavePet).execute(petId, collaboratorId);
            case 'remove':
                return application.get(RemovePetMember).execute({
                    petId,
                    requesterAccountId: ownerId,
                    targetMembershipId: collaboratorMembershipId,
                });
        }
    }

    async function race(
        first: () => Promise<unknown>,
        second: () => Promise<unknown>,
    ): Promise<[SettledAction, SettledAction]> {
        const acquired: Barrier = barrier();
        const released: Barrier = barrier();
        let blockerBackendId: number = 0;
        const blocker: Promise<void> = database.connection.transaction(async (transaction) => {
            const backendRows = await transaction.execute(sql`SELECT pg_backend_pid() AS id`);

            blockerBackendId = Number(backendRows[0].id);
            await transaction.execute(sql`SET LOCAL statement_timeout = '8000ms'`);
            await transaction.select().from(pets).where(eq(pets.id, petId)).for('update');
            acquired.release();
            await released.promise;
        });

        await acquired.promise;
        async function waitForWaiters(expected: number): Promise<void> {
            const deadline: number = Date.now() + 5000;

            while (Date.now() < deadline) {
                const waitingRows = await database.connection.execute(sql`
          WITH RECURSIVE blocked AS (
            SELECT pid FROM pg_stat_activity WHERE ${blockerBackendId} = ANY(pg_blocking_pids(pid))
            UNION
            SELECT activity.pid FROM pg_stat_activity activity JOIN blocked ON blocked.pid = ANY(pg_blocking_pids(activity.pid))
          ) SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE pid IN (SELECT pid FROM blocked) AND wait_event_type = 'Lock' AND query ILIKE '%"pets"%'
        `);

                if (Number(waitingRows[0]?.waiting ?? 0) >= expected) {
                    return;
                }

                await new Promise<void>((resolve) => setImmediate(resolve));
            }

            throw new Error(`Expected ${expected} Pet lock waiters`);
        }

        const firstResult: Promise<SettledAction> = settle(first());
        let secondResult: Promise<SettledAction> | undefined;

        try {
            await waitForWaiters(1);
            secondResult = settle(second());
            await waitForWaiters(2);
        } finally {
            released.release();
            await blocker;
            // Drain operations before fixture cleanup even if observing the locks fails.
            await firstResult;

            if (secondResult !== undefined) {
                await secondResult;
            }
        }

        if (secondResult === undefined) {
            throw new Error('Second operation did not start');
        }

        return Promise.all([firstResult, secondResult]);
    }

    async function update(
        routineId: string,
        fields: Partial<UpdateCareRoutineCommand> = {},
        accountId: string = collaboratorId,
    ) {
        return application.get(UpdateCareRoutine).execute({
            petId,
            routineId,
            authenticatedAccountId: accountId,
            title: 'Updated',
            ...fields,
        });
    }

    async function physical() {
        return database.connection.execute(
            sql`SELECT id, created_at::text, updated_at::text, xmin::text, ctid::text FROM care_routines WHERE pet_id = ${petId}`,
        );
    }

    it('updates all editable facts and preserves identity, creation time, author and other duplicates', async () => {
        const routine = await create();
        const duplicate = await create();
        const original = await rows();
        const originalPhysical = await physical();
        const result = await update(routine.id, {
            type: 'WALK',
            instructions: null,
            timezone: 'UTC',
            frequency: { period: 'DAILY', timesPerPeriod: 2 },
        });
        const persisted = await rows();

        expect(result).toMatchObject({
            id: routine.id,
            petId,
            type: 'WALK',
            title: 'Updated',
            instructions: null,
            timezone: 'UTC',
            frequency: { period: 'DAILY', timesPerPeriod: 2, suggestedTimes: [], weekdays: [] },
            recordedByAccountId: ownerId,
        });
        expect(persisted.find((row) => row.id === duplicate.id)).toEqual(
            original.find((row) => row.id === duplicate.id),
        );
        expect(persisted.find((row) => row.id === routine.id)?.createdAt).toEqual(
            original.find((row) => row.id === routine.id)?.createdAt,
        );
        const updatedPhysical = await physical();

        expect(updatedPhysical.find((row) => row.id === routine.id)?.updated_at).not.toBe(
            originalPhysical.find((row) => row.id === routine.id)?.updated_at,
        );
    });

    it('skips physical UPDATE for normalized no-ops and rolls back domain errors', async () => {
        const routine = await create();
        const original = await physical();
        const petsBefore = await database.connection.select().from(pets).where(eq(pets.id, petId));
        const membershipsBefore = await database.connection
            .select()
            .from(petMemberships)
            .where(eq(petMemberships.petId, petId));

        await update(routine.id, { title: ' Breakfast ', frequency: routine.frequency });
        expect(await physical()).toEqual(original);
        await expect(update(routine.id, { title: ' ' })).rejects.toThrow(InvalidRoutineTitleError);
        expect(await physical()).toEqual(original);
        await update(routine.id);
        expect(await database.connection.select().from(pets).where(eq(pets.id, petId))).toEqual(
            petsBefore,
        );
        expect(
            await database.connection
                .select()
                .from(petMemberships)
                .where(eq(petMemberships.petId, petId)),
        ).toEqual(membershipsBefore);
    });

    it('hides targets before domain validation and denies archived or inactive access', async () => {
        const routine = await create();

        await expect(update(randomUUID(), { title: ' ' }, outsiderId)).rejects.toThrow(
            PetNotFoundError,
        );
        await expect(update(randomUUID(), { title: ' ' })).rejects.toThrow(
            CareRoutineNotFoundError,
        );
        await expect(update(routine.id, { petId: randomUUID() })).rejects.toThrow(PetNotFoundError);
        await changeAccess('leave');
        await expect(update(routine.id)).rejects.toThrow(PetNotFoundError);
        await changeAccess('archive');
        await expect(update(routine.id, {}, ownerId)).rejects.toThrow(PetNotFoundError);
        await application.get(RestorePet).execute({ petId, requesterAccountId: ownerId });
        await expect(update(routine.id, {}, ownerId)).resolves.toMatchObject({ title: 'Updated' });
    });

    it('preserves a departed author while another active member corrects the routine', async () => {
        const routine = await create(collaboratorId);

        await changeAccess('leave');
        await expect(update(routine.id)).rejects.toThrow(PetNotFoundError);
        await expect(update(routine.id, {}, ownerId)).resolves.toMatchObject({
            recordedByAccountId: collaboratorId,
        });
    });

    it.each(['membership', 'routine'] as const)(
        'locks Pet then Membership then Routine when blocked on %s',
        async (blockedRow) => {
            const routine = await create();
            const acquired: Barrier = barrier();
            const released: Barrier = barrier();
            let backendId: number = 0;
            const blocker = database.connection.transaction(async (transaction) => {
                const backendRows = await transaction.execute(sql`SELECT pg_backend_pid() AS id`);

                backendId = Number(backendRows[0].id);
                await transaction.execute(sql`SET LOCAL statement_timeout = '8000ms'`);

                if (blockedRow === 'membership') {
                    await transaction
                        .select()
                        .from(petMemberships)
                        .where(eq(petMemberships.id, collaboratorMembershipId))
                        .for('update');
                } else {
                    await transaction
                        .select()
                        .from(careRoutines)
                        .where(eq(careRoutines.id, routine.id))
                        .for('update');
                }

                acquired.release();
                await released.promise;
            });

            await acquired.promise;
            const correction: Promise<SettledAction> = settle(update(routine.id));

            try {
                const deadline: number = Date.now() + 5000;
                let isWaiting: boolean = false;

                while (Date.now() < deadline) {
                    const waitingRows = await database.connection.execute(
                        sql`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE ${backendId} = ANY(pg_blocking_pids(pid))`,
                    );

                    if (Number(waitingRows[0]?.waiting ?? 0) > 0) {
                        isWaiting = true;
                        break;
                    }

                    await new Promise<void>((resolve) => setImmediate(resolve));
                }

                expect(isWaiting).toBe(true);
                await expect(
                    database.connection.transaction(async (transaction) => {
                        await transaction
                            .select()
                            .from(pets)
                            .where(eq(pets.id, petId))
                            .for('update', { noWait: true });
                    }),
                ).rejects.toThrow();

                if (blockedRow === 'membership') {
                    await database.connection.transaction(async (transaction) => {
                        await transaction
                            .select()
                            .from(careRoutines)
                            .where(eq(careRoutines.id, routine.id))
                            .for('update', { noWait: true });
                    });
                } else {
                    await expect(
                        database.connection.transaction(async (transaction) => {
                            await transaction
                                .select()
                                .from(petMemberships)
                                .where(eq(petMemberships.id, collaboratorMembershipId))
                                .for('update', { noWait: true });
                        }),
                    ).rejects.toThrow();
                }
            } finally {
                released.release();
                await blocker;
                await correction;
            }

            expect((await correction).error).toBeUndefined();
        },
    );

    it('merges concurrent partial corrections from the latest locked state', async () => {
        const routine = await create();
        const [first, second] = await race(
            () => update(routine.id),
            () => update(routine.id, { title: undefined, instructions: null, timezone: 'UTC' }),
        );

        expect(first.error).toBeUndefined();
        expect(second.error).toBeUndefined();
        expect((await rows())[0]).toMatchObject({
            title: 'Updated',
            instructions: null,
            timezone: 'UTC',
        });
    });

    it.each(['archive', 'leave', 'remove'] as const)(
        'serializes %s before update',
        async (action: AccessChange) => {
            const routine = await create();
            const original = await rows();
            const [change, result] = await race(
                () => changeAccess(action),
                () => update(routine.id),
            );

            expect(change.error).toBeUndefined();
            expect(result.error).toBeInstanceOf(PetNotFoundError);
            expect(await rows()).toEqual(original);
        },
    );

    it.each(['archive', 'leave', 'remove'] as const)(
        'serializes update before %s',
        async (action: AccessChange) => {
            const routine = await create();
            const [result, change] = await race(
                () => update(routine.id),
                () => changeAccess(action),
            );

            expect(change.error).toBeUndefined();
            expect(result.error).toBeUndefined();
            expect((await rows())[0]?.title).toBe('Updated');
        },
    );
});
