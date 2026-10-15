import { DeletePetMedication } from '../../src/health/application/delete-pet-medication/delete-pet-medication';
import { DrizzlePetMedicationRepository } from '../../src/health/infrastructure/persistence/drizzle/drizzle-pet-medication.repository';
import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import {
    PetNotFoundError,
    RecordPetMedication,
} from '../../src/health/application/record-pet-medication/record-pet-medication';
import { healthPetMedications } from '../../src/health/infrastructure/persistence/drizzle/health.schema';
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
    UpdatePetMedication,
    PetMedicationNotFoundError,
} from '../../src/health/application/update-pet-medication/update-pet-medication';
import type { PetMedicationCorrection } from '../../src/health/application/persistence/pet-medication.repository';
import { ListPetMedications } from '../../src/health/application/list-pet-medications/list-pet-medications';

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

describe('DeletePetMedication with PostgreSQL (integration)', () => {
    let application: INestApplicationContext;
    let database: DatabaseService;
    let recordPetMedication: RecordPetMedication;
    let updatePetMedication: UpdatePetMedication;
    let petId: string;
    let ownerId: string;
    let collaboratorId: string;
    let outsiderId: string;
    let collaboratorMembershipId: string;
    let otherPetId: string;

    beforeAll(async () => {
        const fixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        application = fixture;
        database = application.get(DatabaseService);
        recordPetMedication = application.get(RecordPetMedication);
        updatePetMedication = application.get(UpdatePetMedication);
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
                name: 'Medication pet',
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
            .delete(healthPetMedications)
            .where(inArray(healthPetMedications.petId, [petId, otherPetId]));
        await database.connection
            .delete(petMemberships)
            .where(inArray(petMemberships.petId, [petId, otherPetId]));
        await database.connection.delete(pets).where(inArray(pets.id, [petId, otherPetId]));

        for (const id of [ownerId, collaboratorId, outsiderId]) {
            await database.connection.delete(accounts).where(eq(accounts.id, id));
        }
    });

    function create(
        accountId: string = ownerId,
        notes: string | null = '  Monitored periodically.  ',
    ) {
        return recordPetMedication.execute({
            petId,
            name: '  Amoxicillin  ',
            dosage: '250 mg',
            frequency: 'Every 12 hours',
            startDate: '2099-10-10',
            plannedEndDate: '2099-10-17',
            notes,
            authenticatedAccountId: accountId,
        });
    }

    function rows() {
        return database.connection
            .select()
            .from(healthPetMedications)
            .where(eq(healthPetMedications.petId, petId));
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
        medicationId: string,
        patch: Partial<PetMedicationCorrection> = { name: 'Other medication' },
        authenticatedAccountId: string = ownerId,
    ) {
        return updatePetMedication.execute({
            petId,
            medicationId,
            authenticatedAccountId,
            ...patch,
        });
    }

    async function physicalRow(medicationId: string) {
        const results = await database.connection.execute(
            sql`SELECT id, pet_id, recorded_by_account_id, name, dosage, frequency, start_date::text AS start_date, planned_end_date::text AS planned_end_date, notes, created_at::text AS created_at, updated_at::text AS updated_at, xmin::text AS version, ctid::text AS location FROM health_pet_medications WHERE id = ${medicationId}`,
        );

        return results[0];
    }

    function remove(medicationId: string, authenticatedAccountId: string = ownerId): Promise<void> {
        return application
            .get(DeletePetMedication)
            .execute({ petId, medicationId, authenticatedAccountId });
    }

    async function assertLocksReleased(medicationId: string): Promise<void> {
        await database.connection.transaction(async (transaction) => {
            await transaction.execute(
                sql`SELECT id FROM pets WHERE id = ${petId} FOR UPDATE NOWAIT`,
            );
            await transaction.execute(
                sql`SELECT id FROM pet_memberships WHERE pet_id = ${petId} FOR UPDATE NOWAIT`,
            );
            await transaction.execute(
                sql`SELECT id FROM health_pet_medications WHERE id = ${medicationId} FOR UPDATE NOWAIT`,
            );
        });
    }

    it.each(['OWNER', 'COLLABORATOR'] as const)(
        'physically deletes as %s regardless of authorship',
        async (role) => {
            const created = await create(role === 'OWNER' ? collaboratorId : ownerId);

            await expect(
                remove(created.id, role === 'OWNER' ? ownerId : collaboratorId),
            ).resolves.toBeUndefined();
            expect(await physicalRow(created.id)).toBeUndefined();
            await assertLocksReleased(created.id);
        },
    );

    it.each([false, true])(
        'removes only the target and updates List, nullable=%s',
        async (hasNullableFields: boolean) => {
            const created = hasNullableFields
                ? await recordPetMedication.execute({
                      petId,
                      authenticatedAccountId: ownerId,
                      name: 'Amoxicillin',
                  })
                : await create();
            const duplicate = await create();
            const otherPetMedicationId: string = randomUUID();

            await database.connection.insert(healthPetMedications).values({
                id: otherPetMedicationId,
                petId: otherPetId,
                name: 'Amoxicillin',
                recordedByAccountId: ownerId,
            });
            const duplicateBefore = await physicalRow(duplicate.id);
            const otherPetBefore = await physicalRow(otherPetMedicationId);

            await remove(created.id);
            expect(await physicalRow(created.id)).toBeUndefined();
            expect(await physicalRow(duplicate.id)).toEqual(duplicateBefore);
            expect(await physicalRow(otherPetMedicationId)).toEqual(otherPetBefore);
            const listed = await application
                .get(ListPetMedications)
                .execute({ petId, authenticatedAccountId: ownerId });

            expect(listed.items.map((medication): string => medication.id)).toEqual([duplicate.id]);
            await expect(remove(created.id)).rejects.toThrow(PetMedicationNotFoundError);
            await remove(duplicate.id);
            await expect(
                application
                    .get(ListPetMedications)
                    .execute({ petId, authenticatedAccountId: ownerId }),
            ).resolves.toEqual({ nextCursor: null, items: [] });
        },
    );

    it('allows deletion after the original author leaves', async () => {
        const created = await create(collaboratorId);

        await changeAccess('leave');
        await expect(remove(created.id)).resolves.toBeUndefined();
        expect(await rows()).toEqual([]);
    });

    it('authorizes before target resolution and preserves rows on all rejections', async () => {
        const created = await create();
        const before = await physicalRow(created.id);
        const repository = application.get(DrizzlePetMedicationRepository);

        await expect(
            repository.deleteIfPetWritable({
                petId: randomUUID(),
                medicationId: created.id,
                authenticatedAccountId: ownerId,
            }),
        ).resolves.toBe('PET_NOT_FOUND');
        await expect(remove(created.id, outsiderId)).rejects.toThrow(PetNotFoundError);
        await expect(remove(randomUUID(), outsiderId)).rejects.toThrow(PetNotFoundError);
        await expect(remove(randomUUID())).rejects.toThrow(PetMedicationNotFoundError);
        await database.connection.insert(petMemberships).values({
            id: randomUUID(),
            petId: otherPetId,
            accountId: ownerId,
            role: 'OWNER',
            status: 'ACTIVE',
        });
        await expect(
            repository.deleteIfPetWritable({
                petId: otherPetId,
                medicationId: created.id,
                authenticatedAccountId: ownerId,
            }),
        ).resolves.toBe('PET_MEDICATION_NOT_FOUND');
        await changeAccess('leave');
        await expect(remove(created.id, collaboratorId)).rejects.toThrow(PetNotFoundError);
        await changeAccess('archive');
        await expect(remove(created.id)).rejects.toThrow(PetNotFoundError);
        expect(await physicalRow(created.id)).toEqual(before);
        await assertLocksReleased(created.id);
    });

    it('does not reconstruct or validate functional fields before deleting', async () => {
        const created = await create();

        await database.connection
            .update(healthPetMedications)
            .set({ name: ' Amoxicillin ' })
            .where(eq(healthPetMedications.id, created.id));
        await expect(remove(created.id)).resolves.toBeUndefined();
        expect(await physicalRow(created.id)).toBeUndefined();
    });

    it('confirms no incoming foreign keys require cascading deletion', async () => {
        const references = await database.connection.execute(
            sql`SELECT conname FROM pg_constraint WHERE contype = 'f' AND confrelid = 'health_pet_medications'::regclass`,
        );

        expect(references).toHaveLength(0);
    });

    it('rolls back the executed DELETE before commit and releases all locks', async () => {
        const created = await create();
        const before = await physicalRow(created.id);
        const failure: Error = new Error('Failure after DELETE before commit');
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
                const outcome: Result = await callback(transaction);

                expect(outcome).toBe('DELETED');
                const deletedRows = await transaction
                    .select({ id: healthPetMedications.id })
                    .from(healthPetMedications)
                    .where(eq(healthPetMedications.id, created.id));

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
        const repository = application.get(DrizzlePetMedicationRepository);
        const command = { petId, medicationId: created.id, authenticatedAccountId: ownerId };
        const [first, second] = await race(
            () => repository.deleteIfPetWritable(command),
            () => repository.deleteIfPetWritable(command),
        );

        expect(first).toEqual({ value: 'DELETED' });
        expect(second).toEqual({ value: 'PET_MEDICATION_NOT_FOUND' });
        expect(await rows()).toEqual([]);
    });

    it.each([true, false])(
        'serializes Delete against Update, deleteFirst=%s',
        async (isDeleteFirst: boolean) => {
            const created = await create();
            const deletion = (): Promise<void> => remove(created.id);
            const correction = (): Promise<unknown> =>
                update(created.id, { dosage: '5 mL' }, collaboratorId);
            const [first, second] = await race(
                isDeleteFirst ? deletion : correction,
                isDeleteFirst ? correction : deletion,
            );

            expect(first.error).toBeUndefined();

            if (isDeleteFirst) {
                expect(first.value).toBeUndefined();
                expect(second.error).toBeInstanceOf(PetMedicationNotFoundError);
            } else {
                expect(first.value).toMatchObject({ id: created.id, dosage: '5 mL' });
                expect(second).toEqual({ value: undefined });
            }

            expect(await rows()).toEqual([]);
        },
    );

    describe.each(['archive', 'leave', 'remove'] as const)('Delete vs %s', (action) => {
        it.each([true, false])(
            'serializes both orders, deleteFirst=%s',
            async (isDeleteFirst: boolean) => {
                const created = await create();
                const before = await physicalRow(created.id);
                const deletion = (): Promise<void> => remove(created.id, collaboratorId);
                const revocation = (): Promise<void> => changeAccess(action);
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

    it.each([true, false])(
        'serializes Delete against Record without deleting other records, deleteFirst=%s',
        async (isDeleteFirst: boolean) => {
            const created = await create();
            const retained = await create();
            const before = await physicalRow(retained.id);
            const deletion = (): Promise<void> => remove(created.id);
            const recording = (): Promise<unknown> => create(collaboratorId);
            const [first, second] = await race(
                isDeleteFirst ? deletion : recording,
                isDeleteFirst ? recording : deletion,
            );

            expect(first.error).toBeUndefined();
            expect(second.error).toBeUndefined();
            expect(await physicalRow(created.id)).toBeUndefined();
            expect(await physicalRow(retained.id)).toEqual(before);
            expect(await rows()).toHaveLength(2);
        },
    );
    it.each(['membership', 'medication'] as const)(
        'locks predecessors before waiting for %s',
        async (target) => {
            const created = await create();
            const acquired: Barrier = barrier();
            const released: Barrier = barrier();
            let blockerBackendId: number = 0;
            const blocker: Promise<void> = database.connection.transaction(async (transaction) => {
                const backendRows = await transaction.execute(sql`SELECT pg_backend_pid() AS id`);

                blockerBackendId = Number(backendRows[0].id);

                if (target === 'membership') {
                    await transaction
                        .select()
                        .from(petMemberships)
                        .where(eq(petMemberships.id, collaboratorMembershipId))
                        .for('update');
                } else {
                    await transaction
                        .select()
                        .from(healthPetMedications)
                        .where(eq(healthPetMedications.id, created.id))
                        .for('update');
                }

                acquired.release();
                await released.promise;
            });

            await acquired.promise;
            const deletion: Promise<SettledAction> = settle(remove(created.id, collaboratorId));

            try {
                const deadline: number = Date.now() + 5000;
                let hasObservedWait: boolean = false;
                const table: string =
                    target === 'membership' ? 'pet_memberships' : 'health_pet_medications';

                while (Date.now() < deadline) {
                    const waiting = await database.connection.execute(
                        sql`SELECT pid FROM pg_stat_activity WHERE ${blockerBackendId} = ANY(pg_blocking_pids(pid)) AND wait_event_type = 'Lock' AND query ILIKE ${`%"${table}"%`}`,
                    );

                    if (waiting.length > 0) {
                        hasObservedWait = true;
                        break;
                    }

                    await new Promise<void>((resolve) => setImmediate(resolve));
                }

                expect(hasObservedWait).toBe(true);
                await expect(
                    database.connection.transaction(async (transaction) => {
                        await transaction.execute(
                            sql`SELECT id FROM pets WHERE id = ${petId} FOR UPDATE NOWAIT`,
                        );
                    }),
                ).rejects.toThrow();

                if (target === 'medication') {
                    await expect(
                        database.connection.transaction(async (transaction) => {
                            await transaction.execute(
                                sql`SELECT id FROM pet_memberships WHERE id = ${collaboratorMembershipId} FOR UPDATE NOWAIT`,
                            );
                        }),
                    ).rejects.toThrow();
                }
            } finally {
                released.release();
                await blocker;
                await deletion;
            }

            expect((await deletion).error).toBeUndefined();
        },
    );

    it('does not consult or lock Medication before rejecting unauthorized access', async () => {
        const created = await create();
        const acquired: Barrier = barrier();
        const released: Barrier = barrier();
        const blocker: Promise<void> = database.connection.transaction(async (transaction) => {
            await transaction
                .select()
                .from(healthPetMedications)
                .where(eq(healthPetMedications.id, created.id))
                .for('update');
            acquired.release();
            await released.promise;
        });

        await acquired.promise;
        const deletion: Promise<SettledAction> = settle(remove(created.id, outsiderId));

        try {
            expect((await deletion).error).toBeInstanceOf(PetNotFoundError);
        } finally {
            released.release();
            await blocker;
            await deletion;
        }
    });

    it('does not acquire a lock on another medication of the same pet', async () => {
        const created = await create();
        const retained = await create();
        const acquired: Barrier = barrier();
        const released: Barrier = barrier();
        const blocker: Promise<void> = database.connection.transaction(async (transaction) => {
            await transaction
                .select({ id: healthPetMedications.id })
                .from(healthPetMedications)
                .where(eq(healthPetMedications.id, retained.id))
                .for('update');
            acquired.release();
            await released.promise;
        });

        await acquired.promise;
        const deletion: Promise<SettledAction> = settle(remove(created.id));

        try {
            expect(await deletion).toEqual({ value: undefined });
        } finally {
            released.release();
            await blocker;
            await deletion;
        }

        expect(await physicalRow(created.id)).toBeUndefined();
        expect(await physicalRow(retained.id)).toBeDefined();
    });
});
