import { UpdateCareRoutine } from '../../src/care/application/update-care-routine/update-care-routine';
import { ListCareActivities } from '../../src/care/application/list-care-activities/list-care-activities';
import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import {
    CompleteCareActivity,
    InvalidActivityCompletedAtError,
    PetNotFoundError,
    CareRoutineNotFoundError,
} from '../../src/care/application/complete-care-activity/complete-care-activity';
import {
    CareActivity,
    CareActivityId,
    CompletedByAccountId,
} from '../../src/care/domain/care-activity/care-activity';
import { PetId, CareRoutineId } from '../../src/care/domain/care-routine/care-routine';
import { ActivityCompletedAt } from '../../src/care/domain/activity-completed-at/activity-completed-at';
import { ActivityTimezone } from '../../src/care/domain/activity-timezone/activity-timezone';
import { DrizzleCareActivityRepository } from '../../src/care/infrastructure/persistence/drizzle/drizzle-care-activity.repository';
import {
    careActivities,
    careRoutines,
} from '../../src/care/infrastructure/persistence/drizzle/care.schema';
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

describe('CompleteCareActivity with PostgreSQL (integration)', () => {
    let application: INestApplicationContext;
    let database: DatabaseService;
    let completeCareActivity: CompleteCareActivity;
    let petId: string;
    let routineId: string;
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
        completeCareActivity = application.get(CompleteCareActivity);
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
        routineId = randomUUID();
        await database.connection.insert(careRoutines).values({
            id: routineId,
            petId,
            type: 'FEEDING',
            title: 'Breakfast',
            frequencyPeriod: 'DAILY',
            timesPerPeriod: 1,
            timezone: 'UTC',
            recordedByAccountId: ownerId,
        });
    });

    afterEach(async () => {
        await database.connection.delete(careActivities).where(eq(careActivities.petId, petId));
        await database.connection.delete(careRoutines).where(eq(careRoutines.petId, petId));
        await database.connection.delete(petMemberships).where(eq(petMemberships.petId, petId));
        await database.connection.delete(pets).where(eq(pets.id, petId));

        for (const accountId of [ownerId, collaboratorId, outsiderId]) {
            await database.connection.delete(accounts).where(eq(accounts.id, accountId));
        }
    });

    function command() {
        return {
            petId,
            routineId,
            authenticatedAccountId: ownerId,
            completedAt: '2020-01-01T01:00:00.000Z',
            timezone: 'America/Mexico_City',
            notes: '  One portion  ',
        };
    }

    function create(accountId: string = ownerId, notes: string | null = '  One portion  ') {
        return completeCareActivity.execute({
            ...command(),
            authenticatedAccountId: accountId,
            notes,
        });
    }

    function rows() {
        return database.connection
            .select()
            .from(careActivities)
            .where(eq(careActivities.petId, petId));
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

    it('persists independent completions, recorder timezone, notes and technical timestamps without updating the routine', async () => {
        const original = await database.connection
            .select()
            .from(careRoutines)
            .where(eq(careRoutines.id, routineId));
        const petBefore = await database.connection.select().from(pets).where(eq(pets.id, petId));
        const membershipsBefore = await database.connection
            .select()
            .from(petMemberships)
            .where(eq(petMemberships.petId, petId));
        const first = await create();
        const second = await create(collaboratorId, null);
        const duplicate = await create();
        const persisted = await rows();

        expect(new Set([first.id, second.id, duplicate.id]).size).toBe(3);
        expect(persisted).toHaveLength(3);

        for (const activity of [first, second, duplicate]) {
            const row = persisted.find((candidate) => candidate.id === activity.id);

            expect(row).toEqual({
                ...activity,
                completedAt: new Date(activity.completedAt),
                createdAt: expect.any(Date) as Date,
                updatedAt: expect.any(Date) as Date,
            });
            expect(row?.createdAt).toEqual(row?.updatedAt);
        }

        expect(
            await database.connection
                .select()
                .from(careRoutines)
                .where(eq(careRoutines.id, routineId)),
        ).toEqual(original);
        expect(await database.connection.select().from(pets).where(eq(pets.id, petId))).toEqual(
            petBefore,
        );
        expect(
            await database.connection
                .select()
                .from(petMemberships)
                .where(eq(petMemberships.petId, petId)),
        ).toEqual(membershipsBefore);
    });

    it('rejects local dates outside the civil range and persists the first supported local day', async () => {
        const boundary = {
            ...command(),
            completedAt: '0001-01-01T00:00:00Z',
            timezone: 'Etc/GMT+1',
        };

        await expect(completeCareActivity.execute(boundary)).rejects.toThrow(
            InvalidActivityCompletedAtError,
        );
        expect(await rows()).toEqual([]);
        const result = await completeCareActivity.execute({
            ...boundary,
            completedAt: '0001-01-01T01:00:00Z',
        });
        const persisted = await database.connection.execute(sql`
            SELECT (completed_at AT TIME ZONE timezone)::date::text AS local_day,
                   to_char(completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS completed_at
            FROM care_activities WHERE id = ${result.id}
        `);

        expect(persisted[0]?.local_day).toBe('0001-01-01');
        expect(persisted[0]?.completed_at).toBe('0001-01-01T01:00:00.000Z');
        expect(
            await application.get(ListCareActivities).execute({
                petId,
                authenticatedAccountId: ownerId,
                from: '0001-01-01',
                to: '0001-01-01',
            }),
        ).toMatchObject({
            items: [{ id: result.id, completedAt: result.completedAt, localDay: '0001-01-01' }],
            nextCursor: null,
        });
    });

    it.each(['0001', '0009', '0049', '0050', '0099', '0100', '0999', '1000'])(
        'round-trips year %s through completion and filtered history with milliseconds',
        async (year: string): Promise<void> => {
            const completedAt: string = `${year}-01-01T01:00:00.123Z`;
            const localDay: string = `${year}-01-01`;
            const result = await completeCareActivity.execute({
                ...command(),
                completedAt,
                timezone: 'Etc/GMT+1',
            });
            const history = await application.get(ListCareActivities).execute({
                petId,
                authenticatedAccountId: ownerId,
                from: localDay,
                to: localDay,
            });

            expect(history).toMatchObject({
                items: [{ id: result.id, completedAt, localDay }],
                nextCursor: null,
            });
        },
    );

    it('hides pet access before checking missing or wrong-pet routines', async () => {
        await expect(create(outsiderId)).rejects.toThrow(PetNotFoundError);
        await expect(
            completeCareActivity.execute({ ...command(), routineId: randomUUID() }),
        ).rejects.toThrow(CareRoutineNotFoundError);
        await expect(
            completeCareActivity.execute({ ...command(), petId: randomUUID() }),
        ).rejects.toThrow(PetNotFoundError);
        await database.connection
            .update(petMemberships)
            .set({ status: 'INACTIVE' })
            .where(eq(petMemberships.id, collaboratorMembershipId));
        await expect(create(collaboratorId)).rejects.toThrow(PetNotFoundError);
        await changeAccess('archive');
        await expect(create()).rejects.toThrow(PetNotFoundError);
        expect(await rows()).toHaveLength(0);
    });

    it('rolls back failed inserts, releases locks and retains timestamp defaults and trigger behavior', async () => {
        const first = await create();
        const repository = application.get(DrizzleCareActivityRepository);
        const record: CareActivity = CareActivity.reconstitute({
            id: CareActivityId.from(first.id),
            petId: PetId.from(petId),
            routineId: CareRoutineId.from(routineId),
            completedAt: ActivityCompletedAt.reconstitute(first.completedAt),
            timezone: ActivityTimezone.from(first.timezone),
            completedBy: CompletedByAccountId.from(first.completedBy),
        });

        await expect(repository.createIfPetWritable(record, ownerId)).rejects.toThrow();
        await expect(create()).resolves.toMatchObject({ petId });
        await database.connection.execute(
            sql`UPDATE care_activities SET updated_at = '2000-01-01', notes = 'Corrected' WHERE id = ${first.id}`,
        );
        const row = (await rows()).find((candidate) => candidate.id === first.id);

        expect(row?.updatedAt.getTime()).toBeGreaterThan(Date.parse('2000-01-01T00:00:00Z'));
        expect(await rows()).toHaveLength(2);
    });

    it('enforces restrictive foreign keys, instant range and bounded text checks', async () => {
        const activity = await create();
        const values = {
            ...activity,
            completedAt: new Date(activity.completedAt),
            id: randomUUID(),
        };

        for (const override of [
            { petId: randomUUID() },
            { routineId: randomUUID() },
            { completedBy: randomUUID() },
            { timezone: '' },
            { notes: ' ' },
            { notes: 'x'.repeat(2001) },
        ]) {
            await expect(
                database.connection.insert(careActivities).values({ ...values, ...override }),
            ).rejects.toThrow();
        }

        for (const completedAt of ['0001-01-01 BC', '10000-01-01', 'infinity', '-infinity']) {
            await expect(
                database.connection.execute(
                    sql`INSERT INTO care_activities (id, pet_id, routine_id, completed_at, completed_by, timezone) VALUES (${randomUUID()}, ${petId}, ${routineId}, ${completedAt}::timestamptz, ${ownerId}, 'UTC')`,
                ),
            ).rejects.toThrow();
        }

        await expect(
            database.connection.delete(careRoutines).where(eq(careRoutines.id, routineId)),
        ).rejects.toThrow();
        await expect(
            database.connection.delete(accounts).where(eq(accounts.id, ownerId)),
        ).rejects.toThrow();
        expect(await rows()).toHaveLength(1);
    });

    it.each(['membership', 'routine'] as const)(
        'locks Pet then Membership then Routine when blocked on %s',
        async (blockedRow) => {
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
                        .where(eq(careRoutines.id, routineId))
                        .for('update');
                }

                acquired.release();
                await released.promise;
            });

            await acquired.promise;
            const completion: Promise<SettledAction> = settle(create(collaboratorId));

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
                            .where(eq(careRoutines.id, routineId))
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
                await completion;
            }

            expect((await completion).error).toBeUndefined();
        },
    );

    it.each(['update-first', 'completion-first'] as const)(
        'serializes routine corrections and completion: %s',
        async (order) => {
            const update = (): Promise<unknown> =>
                application.get(UpdateCareRoutine).execute({
                    petId,
                    routineId,
                    authenticatedAccountId: ownerId,
                    title: 'Dinner',
                    timezone: 'Asia/Tokyo',
                });
            const actions =
                order === 'update-first'
                    ? await race(update, () => create(collaboratorId))
                    : await race(() => create(collaboratorId), update);

            expect(actions.every((action): boolean => action.error === undefined)).toBe(true);
            expect((await rows())[0]).toMatchObject({
                routineId,
                completedBy: collaboratorId,
                timezone: 'America/Mexico_City',
            });
            expect(
                (
                    await database.connection
                        .select()
                        .from(careRoutines)
                        .where(eq(careRoutines.id, routineId))
                )[0],
            ).toMatchObject({ title: 'Dinner', timezone: 'Asia/Tokyo' });
        },
    );

    it('preserves activities through Archive and Restore', async () => {
        await create();
        const original = await rows();

        await changeAccess('archive');
        expect(await rows()).toEqual(original);
        await application.get(RestorePet).execute({ petId, requesterAccountId: ownerId });
        expect(await rows()).toEqual(original);
    });

    it.each(['archive', 'leave', 'remove'] as const)(
        'serializes %s before Complete Activity',
        async (action: AccessChange) => {
            const [change, visit] = await race(
                () => changeAccess(action),
                () => create(collaboratorId),
            );

            expect(change.error).toBeUndefined();
            expect(visit.error).toBeInstanceOf(PetNotFoundError);
            expect(await rows()).toHaveLength(0);
        },
    );
    it.each(['archive', 'leave', 'remove'] as const)(
        'serializes Complete Activity before %s',
        async (action: AccessChange) => {
            const [visit, change] = await race(
                () => create(collaboratorId),
                () => changeAccess(action),
            );

            expect(change.error).toBeUndefined();
            expect(visit.error).toBeUndefined();
            expect(visit.value).toMatchObject({
                petId,
                completedBy: collaboratorId,
            });
            expect(await rows()).toHaveLength(1);
            expect((await rows())[0]?.completedBy).toBe(collaboratorId);
        },
    );
});
