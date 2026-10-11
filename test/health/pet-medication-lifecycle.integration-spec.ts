import { readFileSync } from 'node:fs';
import {
    CompletePetMedication,
    InvalidMedicationEndedDateError,
    PetMedicationLifecycleConflictError,
} from '../../src/health/application/complete-pet-medication/complete-pet-medication';
import { DiscontinuePetMedication } from '../../src/health/application/discontinue-pet-medication/discontinue-pet-medication';
import { ReopenPetMedication } from '../../src/health/application/reopen-pet-medication/reopen-pet-medication';
import { DeletePetMedication } from '../../src/health/application/delete-pet-medication/delete-pet-medication';
import { HEALTH_CLOCK } from '../../src/health/application/time/clock';
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
import {} from '../../src/health/application/record-pet-medication/record-pet-medication';
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

describe('PetMedication lifecycle with PostgreSQL (integration)', () => {
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
        })
            .overrideProvider(HEALTH_CLOCK)
            .useValue({ now: (): Date => new Date('2026-10-11T00:00:00Z') })
            .compile();

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
            startDate: '2026-10-01',
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
            sql`SELECT id, pet_id, recorded_by_account_id, name, dosage, frequency, start_date::text AS start_date, planned_end_date::text AS planned_end_date, notes, status, ended_date::text AS ended_date, discontinuation_reason, created_at::text AS created_at, updated_at::text AS updated_at, xmin::text AS version, ctid::text AS location FROM health_pet_medications WHERE id = ${medicationId}`,
        );

        return results[0];
    }

    function complete(
        medicationId: string,
        endedDate: string | null = '2026-10-10',
        authenticatedAccountId: string = collaboratorId,
    ) {
        return application
            .get(CompletePetMedication)
            .execute({ petId, medicationId, authenticatedAccountId, endedDate });
    }

    function discontinue(
        medicationId: string,
        endedDate: string | null = null,
        discontinuationReason: string | null = null,
    ) {
        return application.get(DiscontinuePetMedication).execute({
            petId,
            medicationId,
            authenticatedAccountId: collaboratorId,
            endedDate,
            discontinuationReason,
        });
    }

    function reopen(medicationId: string) {
        return application
            .get(ReopenPetMedication)
            .execute({ petId, medicationId, authenticatedAccountId: collaboratorId });
    }

    it('persists closures and corrections, preserves authorship, and skips equivalent physical writes', async () => {
        const created = await create();
        const original = await physicalRow(created.id);
        const closed = await complete(created.id);
        const after = await physicalRow(created.id);

        expect(closed).toMatchObject({
            status: 'COMPLETED',
            endedDate: '2026-10-10',
            recordedByAccountId: ownerId,
        });
        expect(after.created_at).toBe(original.created_at);
        await complete(created.id);
        expect(await physicalRow(created.id)).toEqual(after);
        await expect(complete(created.id, null)).rejects.toThrow(
            PetMedicationLifecycleConflictError,
        );
        await expect(discontinue(created.id)).rejects.toThrow(PetMedicationLifecycleConflictError);
        await update(created.id, { endedDate: null });
        expect(await physicalRow(created.id)).toMatchObject({
            status: 'COMPLETED',
            ended_date: null,
        });
        await reopen(created.id);
        const opened = await physicalRow(created.id);

        await reopen(created.id);
        expect(await physicalRow(created.id)).toEqual(opened);
        await discontinue(created.id, '2026-09-01', ' Withdrawn ');
        expect(await physicalRow(created.id)).toMatchObject({
            status: 'DISCONTINUED',
            ended_date: '2026-09-01',
            discontinuation_reason: 'Withdrawn',
        });
        await update(created.id, { discontinuationReason: null });
        await reopen(created.id);
        expect(await physicalRow(created.id)).toMatchObject({
            status: 'OPEN',
            ended_date: null,
            discontinuation_reason: null,
        });
        expect(
            (
                await application
                    .get(ListPetMedications)
                    .execute({ petId, authenticatedAccountId: ownerId })
            ).items[0],
        ).toMatchObject({ status: 'OPEN', recordedByAccountId: ownerId });
    });

    it('validates authorization and target before supplied closure semantics', async () => {
        const created = await create();

        await expect(complete(created.id, 'bad', outsiderId)).rejects.toThrow(PetNotFoundError);
        await expect(complete(randomUUID(), 'bad')).rejects.toThrow(PetMedicationNotFoundError);
        await expect(complete(created.id, '2026-10-12')).rejects.toThrow(
            InvalidMedicationEndedDateError,
        );
        await complete(created.id, null);
        await changeAccess('archive');
        await expect(reopen(created.id)).rejects.toThrow(PetNotFoundError);
        expect(
            (
                await application
                    .get(ListPetMedications)
                    .execute({ petId, authenticatedAccountId: collaboratorId })
            ).items[0].status,
        ).toBe('COMPLETED');
    });

    it.each([
        { status: 'UNKNOWN' },
        { endedDate: '2026-10-01' },
        { discontinuationReason: 'Invalid' },
        { status: 'COMPLETED', discontinuationReason: 'Invalid' },
        { status: 'DISCONTINUED', discontinuationReason: ' ' },
        { status: 'COMPLETED', endedDate: '2026-09-30' },
        { status: 'DISCONTINUED', endedDate: '0000-01-01' },
    ])('enforces lifecycle database constraints for %j', async (invalid) => {
        const created = await create();
        const before = await physicalRow(created.id);

        await expect(
            database.connection
                .update(healthPetMedications)
                .set(invalid)
                .where(eq(healthPetMedications.id, created.id)),
        ).rejects.toThrow();
        expect(await physicalRow(created.id)).toEqual(before);
    });

    it('migrates populated pre-lifecycle data without changing historical facts or timestamps', async () => {
        const initial: string = readFileSync('drizzle/0015_unknown_spirit.sql', 'utf8')
            .split('--> statement-breakpoint')[0]
            .replaceAll('"health_pet_medications"', '"legacy_medication_fixture"')
            .replace('CREATE TABLE', 'CREATE TEMP TABLE');
        const migration: string = readFileSync(
            'drizzle/0016_green_skullbuster.sql',
            'utf8',
        ).replaceAll('"health_pet_medications"', '"legacy_medication_fixture"');

        await database.connection.transaction(async (transaction) => {
            await transaction.execute(sql.raw(initial));
            await transaction.execute(
                sql`CREATE TRIGGER legacy_medication_timestamp BEFORE UPDATE ON legacy_medication_fixture FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
            );
            await transaction.execute(
                sql`INSERT INTO legacy_medication_fixture (id, pet_id, name, recorded_by_account_id, start_date, planned_end_date, created_at, updated_at) VALUES (${randomUUID()}, ${petId}, 'Historical', ${ownerId}, '2020-01-01', '2020-01-02', '2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z')`,
            );
            const before = await transaction.execute(
                sql`SELECT id, pet_id, name, recorded_by_account_id, start_date::text, planned_end_date::text, created_at::text, updated_at::text FROM legacy_medication_fixture`,
            );

            for (const statement of migration.split('--> statement-breakpoint')) {
                await transaction.execute(sql.raw(statement));
            }

            const after = await transaction.execute(
                sql`SELECT id, pet_id, name, recorded_by_account_id, start_date::text, planned_end_date::text, created_at::text, updated_at::text FROM legacy_medication_fixture`,
            );
            const lifecycle = await transaction.execute(
                sql`SELECT status, ended_date, discontinuation_reason FROM legacy_medication_fixture`,
            );

            expect(after).toEqual(before);
            expect(lifecycle[0]).toEqual({
                status: 'OPEN',
                ended_date: null,
                discontinuation_reason: null,
            });
            await transaction.execute(sql`DROP TABLE legacy_medication_fixture`);
        });
    });

    it('rolls back a failed lifecycle UPDATE and releases authorization locks', async () => {
        const created = await create();
        const before = await physicalRow(created.id);

        await expect(discontinue(created.id, null, 'Invalid\u0000reason')).rejects.toThrow();
        expect(await physicalRow(created.id)).toEqual(before);
        await expect(complete(created.id)).resolves.toMatchObject({ status: 'COMPLETED' });
    });

    it.each([true, false])(
        'serializes competing closure types, completeFirst=%s',
        async (isCompleteFirst) => {
            const created = await create();
            const [first, second] = await race(
                () => (isCompleteFirst ? complete(created.id) : discontinue(created.id)),
                () => (isCompleteFirst ? discontinue(created.id) : complete(created.id)),
            );

            expect(first.error).toBeUndefined();
            expect(second.error).toBeInstanceOf(PetMedicationLifecycleConflictError);
            expect(await physicalRow(created.id)).toMatchObject({
                status: isCompleteFirst ? 'COMPLETED' : 'DISCONTINUED',
            });
        },
    );

    it('serializes equivalent closures and closure against correction using current chronology', async () => {
        const created = await create();
        const [first, second] = await race(
            () => complete(created.id),
            () => complete(created.id),
        );

        expect(first.value).toEqual(second.value);
        await reopen(created.id);
        const results = await race(
            () => complete(created.id),
            () => update(created.id, { startDate: '2026-10-11' }),
        );

        expect(results[0].error).toBeUndefined();
        expect(results[1].error).toBeInstanceOf(InvalidMedicationEndedDateError);
        await reopen(created.id);
        const reversed = await race(
            () => update(created.id, { startDate: '2026-10-11' }),
            () => complete(created.id),
        );

        expect(reversed[0].error).toBeUndefined();
        expect(reversed[1].error).toBeInstanceOf(InvalidMedicationEndedDateError);
    });

    it.each([true, false])(
        'serializes closure against Delete, closureFirst=%s',
        async (isClosureFirst) => {
            const created = await create();
            const deletion = (): Promise<void> =>
                application.get(DeletePetMedication).execute({
                    petId,
                    medicationId: created.id,
                    authenticatedAccountId: collaboratorId,
                });
            const results = await race(
                isClosureFirst ? () => complete(created.id) : deletion,
                isClosureFirst ? deletion : () => complete(created.id),
            );

            expect(results[0].error).toBeUndefined();

            if (isClosureFirst) {
                expect(results[1].error).toBeUndefined();
            } else {
                expect(results[1].error).toBeInstanceOf(PetMedicationNotFoundError);
            }

            expect(await rows()).toEqual([]);
        },
    );

    describe.each(['archive', 'leave', 'remove'] as const)('closure against %s', (action) => {
        it.each([true, false])(
            'serializes access changes, closureFirst=%s',
            async (isClosureFirst) => {
                const created = await create();
                const results = await race(
                    isClosureFirst ? () => complete(created.id) : () => changeAccess(action),
                    isClosureFirst ? () => changeAccess(action) : () => complete(created.id),
                );

                expect(results[0].error).toBeUndefined();

                if (isClosureFirst) {
                    expect(results[1].error).toBeUndefined();
                } else {
                    expect(results[1].error).toBeInstanceOf(PetNotFoundError);
                }

                expect(await physicalRow(created.id)).toMatchObject({
                    status: isClosureFirst ? 'COMPLETED' : 'OPEN',
                });
            },
        );
    });

    it.each([true, false])(
        'serializes Reopen against another closure, reopenFirst=%s',
        async (isReopenFirst) => {
            const created = await create();

            await complete(created.id);
            const results = await race(
                isReopenFirst ? () => reopen(created.id) : () => complete(created.id),
                isReopenFirst ? () => complete(created.id) : () => reopen(created.id),
            );

            expect(results[0].error).toBeUndefined();
            expect(results[1].error).toBeUndefined();
            expect(await physicalRow(created.id)).toMatchObject({
                status: isReopenFirst ? 'COMPLETED' : 'OPEN',
            });
        },
    );
});
