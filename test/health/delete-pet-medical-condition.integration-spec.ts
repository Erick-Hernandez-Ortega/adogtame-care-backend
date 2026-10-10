import { DeletePetMedicalCondition } from '../../src/health/application/delete-pet-medical-condition/delete-pet-medical-condition';
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

type AccessChange = 'archive' | 'leave' | 'remove';

describe('DeletePetMedicalCondition with PostgreSQL (integration)', () => {
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

    function remove(conditionId: string, accountId: string = ownerId): Promise<void> {
        return application.get(DeletePetMedicalCondition).execute({
            petId,
            conditionId,
            authenticatedAccountId: accountId,
        });
    }

    async function assertLocksReleased(conditionId: string): Promise<void> {
        await database.connection.transaction(async (transaction) => {
            await transaction.execute(
                sql`SELECT id FROM pets WHERE id = ${petId} FOR UPDATE NOWAIT`,
            );
            await transaction.execute(
                sql`SELECT id FROM pet_memberships WHERE pet_id = ${petId} FOR UPDATE NOWAIT`,
            );
            await transaction.execute(
                sql`SELECT id FROM health_pet_medical_conditions WHERE id = ${conditionId} FOR UPDATE NOWAIT`,
            );
        });
    }

    it.each(['OWNER', 'COLLABORATOR'] as const)(
        'physically deletes as %s regardless of original authorship without Clock',
        async (role) => {
            const requesterId: string = role === 'OWNER' ? ownerId : collaboratorId;
            const authorId: string = role === 'OWNER' ? collaboratorId : ownerId;
            const created = await create(authorId);

            clockCalls = 0;
            await expect(remove(created.id, requesterId)).resolves.toBeUndefined();
            expect(await physicalRow(created.id)).toBeUndefined();
            expect(clockCalls).toBe(0);
            await expect(remove(created.id, requesterId)).rejects.toThrow(
                PetMedicalConditionNotFoundError,
            );
            await assertLocksReleased(created.id);
        },
    );

    it.each(['ACTIVE', 'RESOLVED_KNOWN', 'RESOLVED_UNKNOWN'] as const)(
        'deletes %s and removes only the requested duplicate from List',
        async (state) => {
            const target =
                state === 'ACTIVE'
                    ? await create()
                    : await resolvedCondition(state === 'RESOLVED_KNOWN' ? '2026-03-14' : null);
            const survivor = await create();
            const survivorBefore = await physicalRow(survivor.id);

            await remove(target.id);
            expect(await physicalRow(target.id)).toBeUndefined();
            expect(await physicalRow(survivor.id)).toEqual(survivorBefore);
            expect(
                await application
                    .get(ListPetMedicalConditions)
                    .execute({ petId, authenticatedAccountId: ownerId }),
            ).toMatchObject({ items: [{ id: survivor.id }] });
            await remove(survivor.id);
            expect(await rows()).toEqual([]);
            expect(
                await application
                    .get(ListPetMedicalConditions)
                    .execute({ petId, authenticatedAccountId: ownerId }),
            ).toEqual({ items: [] });
        },
    );

    it('allows another owner to delete after the original author leaves', async () => {
        const created = await create(collaboratorId);

        await changeAccess('leave');
        await remove(created.id);
        expect(await physicalRow(created.id)).toBeUndefined();
    });

    it('authorizes before target lookup and preserves rows on every rejection', async () => {
        const created = await create();
        const otherId: string = randomUUID();

        await database.connection.insert(healthPetMedicalConditions).values({
            id: otherId,
            petId: otherPetId,
            name: 'Other condition',
            recordedByAccountId: ownerId,
        });
        const before = await physicalRow(created.id);
        const otherBefore = await physicalRow(otherId);

        for (const target of [created.id, randomUUID(), otherId]) {
            await expect(remove(target, outsiderId)).rejects.toThrow(PetNotFoundError);
            await assertLocksReleased(created.id);
        }

        for (const target of [randomUUID(), otherId]) {
            await expect(remove(target)).rejects.toThrow(PetMedicalConditionNotFoundError);
            await assertLocksReleased(created.id);
        }

        await expect(
            application.get(DeletePetMedicalCondition).execute({
                petId: randomUUID(),
                conditionId: created.id,
                authenticatedAccountId: ownerId,
            }),
        ).rejects.toThrow(PetNotFoundError);
        await changeAccess('leave');
        await expect(remove(created.id, collaboratorId)).rejects.toThrow(PetNotFoundError);
        await expect(remove(randomUUID(), collaboratorId)).rejects.toThrow(PetNotFoundError);
        await changeAccess('archive');
        await expect(remove(created.id)).rejects.toThrow(PetNotFoundError);
        await expect(remove(randomUUID())).rejects.toThrow(PetNotFoundError);
        expect(await physicalRow(created.id)).toEqual(before);
        expect(await physicalRow(otherId)).toEqual(otherBefore);
        await assertLocksReleased(created.id);
        expect(
            await application
                .get(ListPetMedicalConditions)
                .execute({ petId, authenticatedAccountId: ownerId }),
        ).toMatchObject({ items: [{ id: created.id }] });
    });

    it('confirms no incoming foreign keys prevent condition deletion', async () => {
        const references = await database.connection.execute(
            sql`SELECT conname FROM pg_constraint WHERE contype = 'f' AND confrelid = 'health_pet_medical_conditions'::regclass`,
        );

        expect(references).toHaveLength(0);
    });

    it('rolls back a completed DELETE on failure and releases all locks', async () => {
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
                const deletedRows = await transaction
                    .select()
                    .from(healthPetMedicalConditions)
                    .where(eq(healthPetMedicalConditions.id, created.id));

                expect(deletedRows).toEqual([]);
                throw failure;
            }, configuration);

        try {
            await expect(remove(created.id)).rejects.toBe(failure);
        } finally {
            database.connection.transaction = originalTransaction;
        }

        expect(await physicalRow(created.id)).toEqual(before);
        await assertLocksReleased(created.id);
        await expect(remove(created.id)).resolves.toBeUndefined();
    });

    it('serializes Delete against Delete as DELETED then target not found', async () => {
        const created = await create();
        const repository = application.get(DrizzlePetMedicalConditionRepository);
        const command = { petId, conditionId: created.id, authenticatedAccountId: ownerId };
        const [first, second] = await race(
            () => repository.deleteIfPetWritable(command),
            () => repository.deleteIfPetWritable(command),
        );

        expect(first).toEqual({ value: 'DELETED' });
        expect(second).toEqual({ value: 'PET_MEDICAL_CONDITION_NOT_FOUND' });
        expect(await rows()).toEqual([]);
    });

    describe.each(['update', 'resolve', 'reopen'] as const)('Delete vs %s', (action) => {
        it.each([true, false])(
            'serializes both orders with Delete first: %s',
            async (isDeleteFirst) => {
                const created = action === 'reopen' ? await resolvedCondition() : await create();
                const deletion = () => remove(created.id);
                const mutation = () => {
                    switch (action) {
                        case 'update':
                            return update(created.id);
                        case 'resolve':
                            return resolve(created.id);
                        case 'reopen':
                            return reopen(created.id);
                    }
                };
                const [first, second] = await race(
                    isDeleteFirst ? deletion : mutation,
                    isDeleteFirst ? mutation : deletion,
                );

                expect(first.error).toBeUndefined();

                if (isDeleteFirst) {
                    expect(first.value).toBeUndefined();
                    expect(second.error).toBeInstanceOf(PetMedicalConditionNotFoundError);
                } else {
                    expect(first.value).toMatchObject({
                        id: created.id,
                        status: action === 'resolve' ? 'RESOLVED' : 'ACTIVE',
                    });
                    expect(second).toEqual({ value: undefined });
                }

                expect(await rows()).toEqual([]);
            },
        );
    });

    describe.each(['archive', 'leave', 'remove'] as const)('Delete vs %s', (action) => {
        it.each([true, false])(
            'serializes both orders with Delete first: %s',
            async (isDeleteFirst) => {
                const created = await create();
                const before = await physicalRow(created.id);
                const deletion = () => remove(created.id, collaboratorId);
                const revocation = () => changeAccess(action);
                const [first, second] = await race(
                    isDeleteFirst ? deletion : revocation,
                    isDeleteFirst ? revocation : deletion,
                );

                expect(first.error).toBeUndefined();

                if (isDeleteFirst) {
                    expect(second.error).toBeUndefined();
                    expect(await rows()).toEqual([]);
                } else {
                    expect(second.error).toBeInstanceOf(PetNotFoundError);
                    expect(await physicalRow(created.id)).toEqual(before);
                }

                await assertLocksReleased(created.id);
            },
        );
    });
});
