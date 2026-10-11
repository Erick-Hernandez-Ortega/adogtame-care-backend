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
import { RestorePet } from '../../src/pet-management/application/restore-pet/restore-pet';
import { LeavePet } from '../../src/pet-management/application/leave-pet/leave-pet';
import { RemovePetMember } from '../../src/pet-management/application/remove-pet-member/remove-pet-member';
import {
    UpdatePetMedication,
    PetMedicationNotFoundError,
} from '../../src/health/application/update-pet-medication/update-pet-medication';
import {
    InvalidMedicationNameError,
    InvalidMedicationDosageError,
    InvalidMedicationFrequencyError,
    InvalidMedicationStartDateError,
    InvalidMedicationPlannedEndDateError,
    InvalidMedicationNotesError,
} from '../../src/health/application/record-pet-medication/record-pet-medication';
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

type AccessChange = 'archive' | 'restore' | 'leave' | 'remove';

describe('UpdatePetMedication with PostgreSQL (integration)', () => {
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

    it.each(['OWNER', 'COLLABORATOR'] as const)(
        'allows %s to correct another author and preserves identity and timestamps',
        async (role) => {
            const requester: string = role === 'OWNER' ? ownerId : collaboratorId;
            const created = await create(role === 'OWNER' ? collaboratorId : ownerId);
            const before = await physicalRow(created.id);
            const result = await update(
                created.id,
                {
                    name: ' Other medication ',
                    dosage: ' 5 mL ',
                    frequency: ' Daily ',
                    startDate: '2100-01-01',
                    plannedEndDate: '2100-01-02',
                    notes: ' New notes ',
                },
                requester,
            );

            expect(result).toEqual({
                id: created.id,
                petId,
                name: 'Other medication',
                dosage: '5 mL',
                frequency: 'Daily',
                startDate: '2100-01-01',
                plannedEndDate: '2100-01-02',
                notes: 'New notes',
                status: 'OPEN',
                endedDate: null,
                discontinuationReason: null,
                recordedByAccountId: created.recordedByAccountId,
            });
            const after = await physicalRow(created.id);

            expect(after.created_at).toBe(before.created_at);
            expect(after.updated_at).not.toBe(before.updated_at);
            expect(after.recorded_by_account_id).toBe(created.recordedByAccountId);
        },
    );

    it('preserves omitted fields, clears explicit nulls and skips physical no-ops', async () => {
        const created = await create();
        const before = await physicalRow(created.id);

        await update(created.id, {
            name: ' Amoxicillin ',
            dosage: ' 250 mg ',
            frequency: ' Every 12 hours ',
            notes: ' Monitored periodically. ',
            startDate: created.startDate,
            plannedEndDate: created.plannedEndDate,
        });
        expect(await physicalRow(created.id)).toEqual(before);
        await update(created.id, { dosage: null, frequency: null, notes: null });
        const cleared = await physicalRow(created.id);

        expect(cleared).toMatchObject({
            dosage: null,
            frequency: null,
            notes: null,
            start_date: created.startDate,
            planned_end_date: created.plannedEndDate,
        });
        await update(created.id, { dosage: null, frequency: null, notes: null });
        expect(await physicalRow(created.id)).toEqual(cleared);
        await update(created.id, { startDate: null });
        expect(await physicalRow(created.id)).toMatchObject({
            start_date: null,
            planned_end_date: created.plannedEndDate,
        });
        await update(created.id, { plannedEndDate: null });
        expect(await physicalRow(created.id)).toMatchObject({
            start_date: null,
            planned_end_date: null,
        });
    });

    it.each([
        [{ name: '' }, InvalidMedicationNameError],
        [{ dosage: '' }, InvalidMedicationDosageError],
        [{ frequency: '' }, InvalidMedicationFrequencyError],
        [{ startDate: '2026-02-29' }, InvalidMedicationStartDateError],
        [{ plannedEndDate: 'bad' }, InvalidMedicationPlannedEndDateError],
        [{ startDate: '2099-10-18' }, InvalidMedicationPlannedEndDateError],
        [{ plannedEndDate: '2099-10-09' }, InvalidMedicationPlannedEndDateError],
        [{ notes: '' }, InvalidMedicationNotesError],
    ] as const)(
        'rolls back invalid correction %j and releases locks',
        async (patch, ErrorClass) => {
            const created = await create();
            const before = await physicalRow(created.id);

            await expect(update(created.id, patch)).rejects.toThrow(ErrorClass);
            expect(await physicalRow(created.id)).toEqual(before);
            await expect(update(created.id, { notes: 'Valid retry' })).resolves.toMatchObject({
                notes: 'Valid retry',
            });
        },
    );

    it('rejects corrupt persisted text without silently repairing it or mapping it to a PATCH error', async () => {
        const created = await create();

        await database.connection
            .update(healthPetMedications)
            .set({ name: ' Amoxicillin ' })
            .where(eq(healthPetMedications.id, created.id));
        const before = await physicalRow(created.id);

        await expect(update(created.id)).rejects.toMatchObject({
            constructor: TypeError,
            message: 'Persisted pet medication data is invalid',
        });
        expect(await physicalRow(created.id)).toEqual(before);
    });

    it('checks Pet access before lookup and validates semantics only after finding the medication', async () => {
        const created = await create();
        const patch = { name: '', startDate: 'bad' };

        await expect(update(created.id, patch, outsiderId)).rejects.toThrow(PetNotFoundError);
        await expect(update(randomUUID(), patch)).rejects.toThrow(PetMedicationNotFoundError);
        await expect(
            updatePetMedication.execute({
                petId: otherPetId,
                medicationId: created.id,
                authenticatedAccountId: ownerId,
                ...patch,
            }),
        ).rejects.toThrow(PetNotFoundError);
        await database.connection.insert(petMemberships).values({
            id: randomUUID(),
            petId: otherPetId,
            accountId: ownerId,
            role: 'OWNER',
            status: 'ACTIVE',
        });

        try {
            await expect(
                updatePetMedication.execute({
                    petId: otherPetId,
                    medicationId: created.id,
                    authenticatedAccountId: ownerId,
                    ...patch,
                }),
            ).rejects.toThrow(PetMedicationNotFoundError);
        } finally {
            await database.connection
                .delete(petMemberships)
                .where(eq(petMemberships.petId, otherPetId));
        }

        await expect(
            updatePetMedication.execute({
                petId: randomUUID(),
                medicationId: created.id,
                authenticatedAccountId: ownerId,
                ...patch,
            }),
        ).rejects.toThrow(PetNotFoundError);
        await changeAccess('leave');
        await expect(update(created.id, patch, collaboratorId)).rejects.toThrow(PetNotFoundError);
        await expect(update(created.id, { notes: 'Author-independent' })).resolves.toMatchObject({
            notes: 'Author-independent',
        });
        await changeAccess('archive');
        await expect(update(created.id, patch)).rejects.toThrow(PetNotFoundError);
    });

    it('keeps existing database constraints on updates and preserves other medications', async () => {
        const created = await create();
        const other = await create();
        const before = await physicalRow(other.id);

        for (const invalid of [
            { name: '' },
            { dosage: '' },
            { frequency: '' },
            { notes: '' },
            { name: '🐕'.repeat(256) },
            { dosage: '🐕'.repeat(2001) },
            { frequency: '🐕'.repeat(2001) },
            { notes: '🐕'.repeat(2001) },
            { startDate: '2026-02-29' },
            { startDate: '0000-01-01' },
            { plannedEndDate: '10000-01-01' },
            { plannedEndDate: '2099-10-09' },
        ]) {
            await expect(
                database.connection
                    .update(healthPetMedications)
                    .set(invalid)
                    .where(eq(healthPetMedications.id, created.id)),
            ).rejects.toThrow();
        }

        await update(created.id, {
            name: '🐕'.repeat(255),
            dosage: '🐕'.repeat(2000),
            frequency: '🐕'.repeat(2000),
            notes: '🐕'.repeat(2000),
            startDate: '0001-01-01',
            plannedEndDate: '9999-12-31',
        });
        expect(await physicalRow(other.id)).toEqual(before);
    });

    it.each([false, true])(
        'preserves disjoint concurrent patches without lost updates, reverse=%s',
        async (isReverse: boolean) => {
            const created = await create();
            const nameCorrection = (): Promise<unknown> =>
                update(created.id, { name: 'Other medication' });
            const dosageCorrection = (): Promise<unknown> =>
                update(created.id, { dosage: '5 mL' }, collaboratorId);
            const [first, second] = await race(
                isReverse ? dosageCorrection : nameCorrection,
                isReverse ? nameCorrection : dosageCorrection,
            );

            expect(first.error).toBeUndefined();
            expect(second.error).toBeUndefined();
            expect(second.value).toMatchObject({ name: 'Other medication', dosage: '5 mL' });
            expect(await physicalRow(created.id)).toMatchObject({
                name: 'Other medication',
                dosage: '5 mL',
                recorded_by_account_id: ownerId,
            });
        },
    );

    it('validates concurrent date corrections against the latest committed interval and permits an explicit retry', async () => {
        const created = await create();
        const [first, second] = await race(
            () => update(created.id, { startDate: '2099-10-15' }),
            () => update(created.id, { plannedEndDate: '2099-10-12' }),
        );

        expect(first.error).toBeUndefined();
        expect(second.error).toBeInstanceOf(InvalidMedicationPlannedEndDateError);
        expect(await physicalRow(created.id)).toMatchObject({
            start_date: '2099-10-15',
            planned_end_date: '2099-10-17',
        });
        await expect(update(created.id, { plannedEndDate: '2099-10-16' })).resolves.toMatchObject({
            startDate: '2099-10-15',
            plannedEndDate: '2099-10-16',
        });
    });

    it('applies overlapping concurrent patches in lock order', async () => {
        const created = await create();
        const [first, second] = await race(
            () => update(created.id, { dosage: '5 mL' }),
            () => update(created.id, { dosage: '10 mL' }),
        );

        expect(first.error).toBeUndefined();
        expect(second.value).toMatchObject({ dosage: '10 mL' });
        expect(await physicalRow(created.id)).toMatchObject({ dosage: '10 mL' });
    });

    it.each(['archive', 'leave', 'remove'] as const)(
        'rejects Update after %s wins the Pet lock',
        async (action: AccessChange) => {
            const created = await create();
            const before = await physicalRow(created.id);
            const [change, correction] = await race(
                () => changeAccess(action),
                () => update(created.id, { notes: 'Changed' }, collaboratorId),
            );

            expect(change.error).toBeUndefined();
            expect(correction.error).toBeInstanceOf(PetNotFoundError);
            expect(await physicalRow(created.id)).toEqual(before);
        },
    );

    it.each(['archive', 'leave', 'remove'] as const)(
        'confirms Update before %s changes access',
        async (action: AccessChange) => {
            const created = await create();
            const [correction, change] = await race(
                () => update(created.id, { notes: 'Changed' }, collaboratorId),
                () => changeAccess(action),
            );

            expect(correction.value).toMatchObject({
                notes: 'Changed',
                recordedByAccountId: ownerId,
            });
            expect(change.error).toBeUndefined();
            expect(await physicalRow(created.id)).toMatchObject({ notes: 'Changed' });
        },
    );

    it('retries after a concurrent Restore using current access', async () => {
        const created = await create();

        await changeAccess('archive');
        const [correction, restoration] = await race(
            () => update(created.id),
            () => changeAccess('restore'),
        );

        expect(correction.error).toBeInstanceOf(PetNotFoundError);
        expect(restoration.error).toBeUndefined();
        await expect(update(created.id)).resolves.toMatchObject({ name: 'Other medication' });
    });

    it.each([false, true])(
        'serializes Update and Record on the same pet, recordFirst=%s',
        async (isRecordFirst: boolean) => {
            const created = await create();
            const correction = (): Promise<unknown> => update(created.id, { notes: 'Changed' });
            const recording = (): Promise<unknown> => create(collaboratorId);
            const results = await race(
                isRecordFirst ? recording : correction,
                isRecordFirst ? correction : recording,
            );

            expect(results.every((result): boolean => result.error === undefined)).toBe(true);
            expect(await rows()).toHaveLength(2);
            expect(await physicalRow(created.id)).toMatchObject({ notes: 'Changed' });
        },
    );

    it('serializes updates of different medications without changing their other fields', async () => {
        const firstMedication = await create();
        const secondMedication = await create();
        const [first, second] = await race(
            () => update(firstMedication.id, { dosage: null }),
            () => update(secondMedication.id, { notes: null }),
        );

        expect(first.error).toBeUndefined();
        expect(second.error).toBeUndefined();
        expect(await physicalRow(firstMedication.id)).toMatchObject({
            dosage: null,
            notes: firstMedication.notes,
        });
        expect(await physicalRow(secondMedication.id)).toMatchObject({
            dosage: secondMedication.dosage,
            notes: null,
        });
        const listed = await application
            .get(ListPetMedications)
            .execute({ petId, authenticatedAccountId: ownerId });

        expect(listed.items).toHaveLength(2);
    });
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
            const correction: Promise<SettledAction> = settle(
                update(created.id, { dosage: '5 mL' }, collaboratorId),
            );

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
                await correction;
            }

            expect((await correction).error).toBeUndefined();
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
        const correction: Promise<SettledAction> = settle(
            update(created.id, { startDate: 'bad' }, outsiderId),
        );

        try {
            expect((await correction).error).toBeInstanceOf(PetNotFoundError);
        } finally {
            released.release();
            await blocker;
            await correction;
        }
    });
    it('rolls back a real failed UPDATE and permits the next command after releasing locks', async () => {
        const created = await create();
        const before = await physicalRow(created.id);

        await expect(
            update(created.id, { name: 'Other medication', notes: '\u0000' }),
        ).rejects.toThrow();
        expect(await physicalRow(created.id)).toEqual(before);
        await expect(
            update(created.id, { notes: 'Retry succeeded' }, collaboratorId),
        ).resolves.toMatchObject({ name: created.name, notes: 'Retry succeeded' });
    });

    it('preserves historical authorship after the author leaves', async () => {
        const created = await create(collaboratorId);

        await changeAccess('leave');
        await expect(update(created.id, { notes: 'Corrected by owner' })).resolves.toMatchObject({
            recordedByAccountId: collaboratorId,
            notes: 'Corrected by owner',
        });
    });
});
