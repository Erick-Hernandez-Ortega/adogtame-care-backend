import { ReopenPetMedicalCondition } from '../../src/health/application/reopen-pet-medical-condition/reopen-pet-medical-condition';
import { DrizzlePetMedicalConditionRepository } from '../../src/health/infrastructure/persistence/drizzle/drizzle-pet-medical-condition.repository';
import { ResolvePetMedicalCondition } from '../../src/health/application/resolve-pet-medical-condition/resolve-pet-medical-condition';
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

describe('ReopenPetMedicalCondition with PostgreSQL (integration)', () => {
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

    function reopen(conditionId: string, accountId: string = ownerId) {
        return application.get(ReopenPetMedicalCondition).execute({
            petId,
            conditionId,
            authenticatedAccountId: accountId,
        });
    }

    async function resolvedCondition(resolvedDate: string | null = '2026-03-14') {
        const created = await create();

        await update(created.id, { diagnosedDate: '2026-02-10' });

        return resolve(created.id, resolvedDate);
    }

    it.each(['OWNER', 'COLLABORATOR'] as const)(
        'reopens as %s preserving clinical data, identity and author with one physical UPDATE',
        async (role) => {
            const resolved = await resolvedCondition();
            const before = await physicalRow(resolved.id);

            currentTime = new Date('2000-01-01');
            clockCalls = 0;
            const result = await reopen(resolved.id, role === 'OWNER' ? ownerId : collaboratorId);

            expect(result).toEqual({ ...resolved, status: 'ACTIVE', resolvedDate: null });
            expect(clockCalls).toBe(0);
            const after = await physicalRow(resolved.id);
            const {
                version: oldVersion,
                location: oldLocation,
                updated_at: oldUpdatedAt,
                ...preserved
            } = before;

            expect(after).toMatchObject({ ...preserved, status: 'ACTIVE', resolved_date: null });
            expect(after.version).not.toBe(oldVersion);
            expect(after.location).not.toBe(oldLocation);
            expect(after.updated_at).not.toBe(oldUpdatedAt);
            expect(await reopen(resolved.id)).toEqual(result);
            expect(await physicalRow(resolved.id)).toEqual(after);
            expect(clockCalls).toBe(0);
            expect(
                await application
                    .get(ListPetMedicalConditions)
                    .execute({ petId, authenticatedAccountId: ownerId }),
            ).toMatchObject({
                items: [
                    {
                        id: resolved.id,
                        status: 'ACTIVE',
                        resolvedDate: null,
                        recordedByAccountId: ownerId,
                    },
                ],
            });
        },
    );

    it('reopens an unknown resolution date', async () => {
        const resolved = await resolvedCondition(null);

        expect(await reopen(resolved.id)).toEqual({
            ...resolved,
            status: 'ACTIVE',
            resolvedDate: null,
        });
    });

    it('returns UNCHANGED for an initially ACTIVE target without a physical UPDATE', async () => {
        const created = await create();
        const before = await physicalRow(created.id);
        const repository = application.get(DrizzlePetMedicalConditionRepository);

        clockCalls = 0;
        expect(
            await repository.reopenIfPetWritable({
                petId,
                conditionId: created.id,
                authenticatedAccountId: collaboratorId,
            }),
        ).toMatchObject({ status: 'UNCHANGED' });
        expect(await reopen(created.id)).toEqual(created);
        expect(await physicalRow(created.id)).toEqual(before);
        expect(clockCalls).toBe(0);
    });

    it('authorizes before resolving missing or foreign targets and requires access even for no-ops', async () => {
        const created = await create();
        const otherId: string = randomUUID();

        await database.connection.insert(healthPetMedicalConditions).values({
            id: otherId,
            petId: otherPetId,
            name: 'Other',
            recordedByAccountId: ownerId,
        });
        clockCalls = 0;

        for (const target of [created.id, randomUUID(), otherId]) {
            await expect(reopen(target, outsiderId)).rejects.toThrow(PetNotFoundError);
        }

        for (const target of [randomUUID(), otherId]) {
            await expect(reopen(target)).rejects.toThrow(PetMedicalConditionNotFoundError);
        }

        await changeAccess('leave');
        await expect(reopen(created.id, collaboratorId)).rejects.toThrow(PetNotFoundError);
        await expect(reopen(randomUUID(), collaboratorId)).rejects.toThrow(PetNotFoundError);
        await changeAccess('archive');
        await expect(reopen(created.id)).rejects.toThrow(PetNotFoundError);
        await expect(reopen(randomUUID())).rejects.toThrow(PetNotFoundError);
        await expect(
            application.get(ReopenPetMedicalCondition).execute({
                petId: randomUUID(),
                conditionId: created.id,
                authenticatedAccountId: ownerId,
            }),
        ).rejects.toThrow(PetNotFoundError);
        expect(clockCalls).toBe(0);
        expect(
            await application
                .get(ListPetMedicalConditions)
                .execute({ petId, authenticatedAccountId: ownerId }),
        ).toMatchObject({ items: [{ id: created.id }] });
    });
    it('rolls back a completed UPDATE on transaction failure and releases locks', async () => {
        const created = await resolvedCondition();
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
            await expect(reopen(created.id)).rejects.toBe(failure);
        } finally {
            database.connection.transaction = originalTransaction;
        }

        expect(await physicalRow(created.id)).toEqual(before);
        await expect(reopen(created.id)).resolves.toMatchObject({
            status: 'ACTIVE',
            resolvedDate: null,
        });
    });

    it('serializes Reopen against Reopen as REOPENED then UNCHANGED with one UPDATE', async () => {
        const resolved = await resolvedCondition();
        const repository = application.get(DrizzlePetMedicalConditionRepository);
        const command = { petId, conditionId: resolved.id, authenticatedAccountId: ownerId };
        const before = await physicalRow(resolved.id);
        const [first, second] = await race(
            () => repository.reopenIfPetWritable(command),
            () => repository.reopenIfPetWritable(command),
        );

        expect(first).toMatchObject({ value: { status: 'REOPENED' } });
        expect(second).toMatchObject({ value: { status: 'UNCHANGED' } });
        expect(second.value).toMatchObject({ condition: { status: 'ACTIVE', resolvedDate: null } });
        const after = await physicalRow(resolved.id);

        expect(after.version).not.toBe(before.version);
        await reopen(resolved.id);
        expect(await physicalRow(resolved.id)).toEqual(after);
    });

    it.each([false, true])(
        'serializes Reopen and Resolve in either order: %s',
        async (isReopenFirst) => {
            const created = isReopenFirst ? await resolvedCondition() : await create();
            const reopening = () => reopen(created.id);
            const resolution = () => resolve(created.id, '2026-03-13');
            const [first, second] = await race(
                isReopenFirst ? reopening : resolution,
                isReopenFirst ? resolution : reopening,
            );

            expect(first.error).toBeUndefined();
            expect(second.error).toBeUndefined();
            expect(first.value).toMatchObject({ status: isReopenFirst ? 'ACTIVE' : 'RESOLVED' });
            expect(second.value).toMatchObject({ status: isReopenFirst ? 'RESOLVED' : 'ACTIVE' });
            expect((await rows())[0]).toMatchObject({
                status: isReopenFirst ? 'RESOLVED' : 'ACTIVE',
                resolvedDate: isReopenFirst ? '2026-03-13' : null,
            });
        },
    );

    it.each([false, true])(
        'serializes Reopen and Update preserving corrections in either order: %s',
        async (isReopenFirst) => {
            const resolved = await resolvedCondition();
            const reopening = () => reopen(resolved.id);
            const correction = () =>
                update(resolved.id, {
                    name: 'Corrected',
                    diagnosedDate: '2026-03-14',
                    notes: 'Corrected notes',
                });
            const [first, second] = await race(
                isReopenFirst ? reopening : correction,
                isReopenFirst ? correction : reopening,
            );

            expect(first.error).toBeUndefined();
            expect(second.error).toBeUndefined();
            expect((await rows())[0]).toMatchObject({
                name: 'Corrected',
                diagnosedDate: '2026-03-14',
                notes: 'Corrected notes',
                status: 'ACTIVE',
                resolvedDate: null,
                recordedByAccountId: ownerId,
            });
        },
    );
    it.each(['archive', 'leave', 'remove'] as const)(
        'rejects when %s commits before Reopen',
        async (action) => {
            const created = await resolvedCondition();
            const before = await physicalRow(created.id);
            const [change, resolution] = await race(
                () => changeAccess(action),
                () => reopen(created.id, collaboratorId),
            );

            expect(change.error).toBeUndefined();
            expect(resolution.error).toBeInstanceOf(PetNotFoundError);
            expect(await physicalRow(created.id)).toEqual(before);
        },
    );

    it.each(['archive', 'leave', 'remove'] as const)('commits Reopen before %s', async (action) => {
        const created = await resolvedCondition();
        const [resolution, change] = await race(
            () => reopen(created.id, collaboratorId),
            () => changeAccess(action),
        );

        expect(resolution.value).toMatchObject({ status: 'ACTIVE' });
        expect(change.error).toBeUndefined();
        expect((await rows())[0]).toMatchObject({
            status: 'ACTIVE',
            resolvedDate: null,
        });
    });
});
