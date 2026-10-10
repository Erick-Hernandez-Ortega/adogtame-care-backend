import {
    ResolvePetMedicalCondition,
    InvalidMedicalConditionResolvedDateError,
} from '../../src/health/application/resolve-pet-medical-condition/resolve-pet-medical-condition';
import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import {
    PetNotFoundError,
    RecordPetMedicalCondition,
} from '../../src/health/application/record-pet-medical-condition/record-pet-medical-condition';
import { healthPetMedicalConditions } from '../../src/health/infrastructure/persistence/drizzle/health.schema';
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
import {
    UpdatePetMedicalCondition,
    PetMedicalConditionNotFoundError,
} from '../../src/health/application/update-pet-medical-condition/update-pet-medical-condition';
import { HEALTH_CLOCK } from '../../src/health/application/time/clock';
import type { PetMedicalConditionCorrection } from '../../src/health/application/persistence/pet-medical-condition.repository';
import { ListPetMedicalConditions } from '../../src/health/application/list-pet-medical-conditions/list-pet-medical-conditions';

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

type AccessChange = 'archive' | 'restore' | 'leave' | 'remove';

describe('ResolvePetMedicalCondition with PostgreSQL (integration)', () => {
    let currentTime: Date;
    let clockCalls: number = 0;
    const now = (): Date => {
        clockCalls += 1;

        return currentTime;
    };
    let application: INestApplicationContext;
    let database: DatabaseService;
    let recordPetMedicalCondition: RecordPetMedicalCondition;
    let updatePetMedicalCondition: UpdatePetMedicalCondition;
    let petId: string;
    let ownerId: string;
    let collaboratorId: string;
    let outsiderId: string;
    let collaboratorMembershipId: string;
    let otherPetId: string;

    beforeAll(async () => {
        const fixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        })
            .overrideProvider(HEALTH_CLOCK)
            .useValue({ now })
            .compile();

        application = fixture;
        database = application.get(DatabaseService);
        recordPetMedicalCondition = application.get(RecordPetMedicalCondition);
        updatePetMedicalCondition = application.get(UpdatePetMedicalCondition);
    });

    afterAll(async () => {
        await application.close();
    });

    beforeEach(async () => {
        currentTime = new Date('2026-03-14T00:30:00Z');
        clockCalls = 0;
        petId = randomUUID();
        otherPetId = randomUUID();
        ownerId = randomUUID();
        collaboratorId = randomUUID();
        outsiderId = randomUUID();
        collaboratorMembershipId = randomUUID();
        await database.connection.insert(accounts).values(
            [ownerId, collaboratorId, outsiderId].map((id) => ({
                id,
                email: `${id}@example.com`,
                passwordHash: 'test-hash',
            })),
        );
        await database.connection.insert(pets).values(
            [petId, otherPetId].map((identifier: string) => ({
                id: identifier,
                name: 'Medical condition pet',
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
                id: collaboratorMembershipId,
                petId,
                accountId: collaboratorId,
                role: 'COLLABORATOR',
                status: 'ACTIVE',
            },
        ]);
    });

    afterEach(async () => {
        await database.connection
            .delete(healthPetMedicalConditions)
            .where(inArray(healthPetMedicalConditions.petId, [petId, otherPetId]));
        await database.connection.delete(petMemberships).where(eq(petMemberships.petId, petId));
        await database.connection.delete(pets).where(inArray(pets.id, [petId, otherPetId]));

        for (const id of [ownerId, collaboratorId, outsiderId]) {
            await database.connection.delete(accounts).where(eq(accounts.id, id));
        }
    });

    function create(
        accountId: string = ownerId,
        notes: string | null = '  Monitored periodically.  ',
    ) {
        return recordPetMedicalCondition.execute({
            petId,
            name: '  Arthritis  ',
            diagnosedDate: null,
            notes,
            authenticatedAccountId: accountId,
        });
    }

    function rows() {
        return database.connection
            .select()
            .from(healthPetMedicalConditions)
            .where(eq(healthPetMedicalConditions.petId, petId));
    }

    function changeAccess(action: AccessChange): Promise<void> {
        switch (action) {
            case 'archive':
                return application.get(ArchivePet).execute({ petId, requesterAccountId: ownerId });
            case 'restore':
                return application.get(RestorePet).execute({ petId, requesterAccountId: ownerId });
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

    function update(
        conditionId: string,
        patch: Partial<PetMedicalConditionCorrection> = { name: 'Osteoarthritis' },
        authenticatedAccountId: string = ownerId,
    ) {
        return updatePetMedicalCondition.execute({
            petId,
            conditionId,
            authenticatedAccountId,
            ...patch,
        });
    }

    async function physicalRow(conditionId: string) {
        const results = await database.connection.execute(
            sql`SELECT id, pet_id, recorded_by_account_id, name, status, diagnosed_date, resolved_date, notes, created_at::text AS created_at, updated_at::text AS updated_at, xmin::text AS version, ctid::text AS location FROM health_pet_medical_conditions WHERE id = ${conditionId}`,
        );

        return results[0];
    }

    function resolve(
        conditionId: string,
        resolvedDate: string | null = '2026-03-14',
        accountId: string = ownerId,
    ) {
        return application
            .get(ResolvePetMedicalCondition)
            .execute({ petId, conditionId, authenticatedAccountId: accountId, resolvedDate });
    }

    it.each(['OWNER', 'COLLABORATOR'])(
        'resolves as %s and preserves physical row on retries',
        async (role) => {
            const created = await create();

            const before = await physicalRow(created.id);

            clockCalls = 0;
            const result = await resolve(
                created.id,
                '2026-03-14',
                role === 'OWNER' ? ownerId : collaboratorId,
            );

            expect(result).toEqual({ ...created, status: 'RESOLVED', resolvedDate: '2026-03-14' });
            expect(clockCalls).toBe(1);
            const after = await physicalRow(created.id);

            expect(after).toMatchObject({
                created_at: before.created_at,
                recorded_by_account_id: ownerId,
                status: 'RESOLVED',
                resolved_date: '2026-03-14',
            });
            expect(after.version).not.toBe(before.version);
            expect(after.updated_at).not.toBe(before.updated_at);

            for (const retryDate of [null, 'invalid', '9999-01-01', '2026-03-13']) {
                clockCalls = 0;
                expect(await resolve(created.id, retryDate)).toEqual(result);
                expect(clockCalls).toBe(1);
                expect(await physicalRow(created.id)).toEqual(after);
            }

            expect(
                await update(created.id, { name: 'Corrected', diagnosedDate: '2026-03-14' }),
            ).toMatchObject({ status: 'RESOLVED', resolvedDate: '2026-03-14' });
            expect(
                await application
                    .get(ListPetMedicalConditions)
                    .execute({ petId, authenticatedAccountId: ownerId }),
            ).toMatchObject({ items: [{ status: 'RESOLVED', resolvedDate: '2026-03-14' }] });
            currentTime = new Date('2000-01-01');
            expect(await resolve(created.id, 'invalid')).toMatchObject({
                resolvedDate: '2026-03-14',
            });
            expect(await update(created.id, { notes: 'Historical' })).toMatchObject({
                resolvedDate: '2026-03-14',
            });
        },
    );

    it('supports unknown and retrospective dates without ordering against diagnosis', async () => {
        const first = await create();
        const second = await create();

        await update(second.id, { diagnosedDate: '2026-03-14' });
        clockCalls = 0;
        expect(await resolve(first.id, null)).toMatchObject({
            status: 'RESOLVED',
            resolvedDate: null,
        });
        expect(clockCalls).toBe(1);
        const unknownBefore = await physicalRow(first.id);

        expect(await resolve(first.id, 'invalid')).toMatchObject({ resolvedDate: null });
        expect(await physicalRow(first.id)).toEqual(unknownBefore);
        expect(await resolve(second.id, '2026-01-01')).toMatchObject({
            diagnosedDate: '2026-03-14',
            resolvedDate: '2026-01-01',
        });
    });

    it('authorizes before target lookup and validates only after finding target', async () => {
        const created = await create();
        const otherId: string = randomUUID();

        await database.connection.insert(healthPetMedicalConditions).values({
            id: otherId,
            petId: otherPetId,
            name: 'Other',
            recordedByAccountId: ownerId,
        });
        clockCalls = 0;
        await expect(resolve(created.id, 'invalid', outsiderId)).rejects.toThrow(PetNotFoundError);

        for (const target of [randomUUID(), otherId]) {
            await expect(resolve(target, 'invalid')).rejects.toThrow(
                PetMedicalConditionNotFoundError,
            );
        }

        expect(clockCalls).toBe(0);
        await changeAccess('leave');
        await expect(resolve(created.id, 'invalid', collaboratorId)).rejects.toThrow(
            PetNotFoundError,
        );
        await changeAccess('archive');
        await expect(resolve(created.id, 'invalid')).rejects.toThrow(PetNotFoundError);
        const missingPetId: string = randomUUID();

        await expect(
            application.get(ResolvePetMedicalCondition).execute({
                petId: missingPetId,
                conditionId: created.id,
                authenticatedAccountId: ownerId,
                resolvedDate: 'invalid',
            }),
        ).rejects.toThrow(PetNotFoundError);
        expect(clockCalls).toBe(0);
    });

    it.each(['invalid', '2026-02-29', '2026-03-15'])(
        'rolls back invalid resolution %s',
        async (resolvedDate) => {
            const created = await create();
            const before = await physicalRow(created.id);

            await expect(resolve(created.id, resolvedDate)).rejects.toThrow(
                InvalidMedicalConditionResolvedDateError,
            );
            expect(await physicalRow(created.id)).toEqual(before);
            await resolve(created.id);
        },
    );

    it('rolls back a completed UPDATE on transaction failure and releases locks', async () => {
        const created = await create();
        const before = await physicalRow(created.id);
        const failure: Error = new Error('Commit workflow failed');
        const originalTransaction = database.connection.transaction.bind(
            database.connection,
        ) as DatabaseService['connection']['transaction'];

        type Transaction = Parameters<Parameters<typeof originalTransaction>[0]>[0];
        type Configuration = Parameters<typeof originalTransaction>[1];

        database.connection.transaction = <Result>(
            callback: (transaction: Transaction) => Promise<Result>,
            configuration?: Configuration,
        ): Promise<Result> =>
            originalTransaction(async (transaction) => {
                await callback(transaction);

                throw failure;
            }, configuration);

        try {
            await expect(resolve(created.id)).rejects.toBe(failure);
        } finally {
            database.connection.transaction = originalTransaction;
        }

        expect(await physicalRow(created.id)).toEqual(before);
        await expect(resolve(created.id)).resolves.toMatchObject({ status: 'RESOLVED' });
    });

    it('database CHECK rejects ACTIVE with a date but permits RESOLVED null', async () => {
        const created = await create();

        await expect(
            database.connection
                .update(healthPetMedicalConditions)
                .set({ resolvedDate: '2026-03-14' })
                .where(eq(healthPetMedicalConditions.id, created.id)),
        ).rejects.toThrow();
        expect(await resolve(created.id, null)).toMatchObject({
            status: 'RESOLVED',
            resolvedDate: null,
        });
    });

    it('serializes Resolve against Resolve preserving the first date without another UPDATE', async () => {
        const created = await create();
        let firstRow: Awaited<ReturnType<typeof physicalRow>> | undefined;
        const [first, second] = await race(
            async () => {
                const result = await resolve(created.id, '2026-03-13');

                firstRow = await physicalRow(created.id);

                return result;
            },
            () => resolve(created.id, 'invalid'),
        );

        expect(first.error).toBeUndefined();
        expect(second.value).toEqual(first.value);
        expect(await physicalRow(created.id)).toEqual(firstRow);
    });

    it.each([false, true])(
        'serializes Resolve and Update in either order: %s',
        async (isResolveFirst) => {
            const created = await create();
            const resolution = () => resolve(created.id);
            const correction = () =>
                update(created.id, { name: 'Corrected', diagnosedDate: '2026-03-14' });
            const [first, second] = await race(
                isResolveFirst ? resolution : correction,
                isResolveFirst ? correction : resolution,
            );

            expect(first.error).toBeUndefined();
            expect(second.error).toBeUndefined();
            expect((await rows())[0]).toMatchObject({
                name: 'Corrected',
                status: 'RESOLVED',
                resolvedDate: '2026-03-14',
                diagnosedDate: '2026-03-14',
            });
        },
    );

    it.each(['archive', 'leave', 'remove'] as const)(
        'rejects when %s commits before Resolve',
        async (action) => {
            const created = await create();
            const before = await physicalRow(created.id);
            const [change, resolution] = await race(
                () => changeAccess(action),
                () => resolve(created.id, '2026-03-14', collaboratorId),
            );

            expect(change.error).toBeUndefined();
            expect(resolution.error).toBeInstanceOf(PetNotFoundError);
            expect(await physicalRow(created.id)).toEqual(before);
        },
    );

    it.each(['archive', 'leave', 'remove'] as const)(
        'commits Resolve before %s',
        async (action) => {
            const created = await create();
            const [resolution, change] = await race(
                () => resolve(created.id, '2026-03-14', collaboratorId),
                () => changeAccess(action),
            );

            expect(resolution.value).toMatchObject({ status: 'RESOLVED' });
            expect(change.error).toBeUndefined();
            expect((await rows())[0]).toMatchObject({
                status: 'RESOLVED',
                resolvedDate: '2026-03-14',
            });
        },
    );
    it('samples Clock once after waiting for locks across UTC midnight', async () => {
        const created = await create();

        clockCalls = 0;
        const acquired: Barrier = barrier();
        const released: Barrier = barrier();
        let backendId: number = 0;
        const blocker = database.connection.transaction(async (transaction) => {
            const backendRows = await transaction.execute(sql`SELECT pg_backend_pid() AS id`);

            backendId = Number(backendRows[0].id);
            await transaction.select().from(pets).where(eq(pets.id, petId)).for('update');
            acquired.release();
            await released.promise;
        });

        await acquired.promise;
        const correction = settle(resolve(created.id, '2026-03-15'));

        try {
            const deadline: number = Date.now() + 5000;
            let hasWaiter: boolean = false;

            while (Date.now() < deadline) {
                const waiting = await database.connection.execute(
                    sql`SELECT count(*)::int AS count FROM pg_stat_activity WHERE ${backendId} = ANY(pg_blocking_pids(pid))`,
                );

                if (Number(waiting[0]?.count) > 0) {
                    hasWaiter = true;
                    break;
                }

                await new Promise<void>((resolve) => setImmediate(resolve));
            }

            expect(hasWaiter).toBe(true);
            expect(clockCalls).toBe(0);
            currentTime = new Date('2026-03-15T00:00:00Z');
        } finally {
            released.release();
            await blocker;
            await correction;
        }

        expect(await correction).toMatchObject({
            value: { resolvedDate: '2026-03-15' },
        });
        expect(clockCalls).toBe(1);
    });
});
