import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import {
    RecordPetMedication,
    PetNotFoundError,
    InvalidMedicationNameError,
    InvalidMedicationDosageError,
    InvalidMedicationFrequencyError,
    InvalidMedicationStartDateError,
    InvalidMedicationPlannedEndDateError,
    InvalidMedicationNotesError,
} from '../../src/health/application/record-pet-medication/record-pet-medication';
import { PetMedicationId } from '../../src/health/domain/pet-medication/pet-medication';
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

describe('RecordPetMedication with PostgreSQL (integration)', () => {
    let application: INestApplicationContext;
    let database: DatabaseService;
    let recordPetMedication: RecordPetMedication;
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
        recordPetMedication = application.get(RecordPetMedication);
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
            name: 'Medication pet',
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
        await database.connection
            .delete(healthPetMedications)
            .where(eq(healthPetMedications.petId, petId));
        await database.connection.delete(petMemberships).where(eq(petMemberships.petId, petId));
        await database.connection.delete(pets).where(eq(pets.id, petId));

        for (const accountId of [ownerId, collaboratorId, outsiderId]) {
            await database.connection.delete(accounts).where(eq(accounts.id, accountId));
        }
    });

    function create(accountId: string = ownerId, notes: string | null = '  Give with food  ') {
        return recordPetMedication.execute({
            petId,
            name: '  Amoxicillin  ',
            dosage: '  250 mg  ',
            frequency: '  Every 12 hours  ',
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

    it('persists exact normalized fields for both roles, technical timestamps and independent duplicates', async () => {
        const ownerRecord = await create();
        const collaboratorRecord = await create(collaboratorId, null);
        const duplicate = await create();
        const persisted = await rows();

        expect(new Set([ownerRecord.id, collaboratorRecord.id, duplicate.id]).size).toBe(3);
        expect(persisted).toHaveLength(3);

        for (const record of [ownerRecord, collaboratorRecord, duplicate]) {
            const row = persisted.find((candidate) => candidate.id === record.id);

            expect(row).toEqual({
                ...record,
                createdAt: expect.any(Date) as Date,
                updatedAt: expect.any(Date) as Date,
            });
            expect(row?.createdAt).toEqual(row?.updatedAt);
        }

        expect(ownerRecord).toMatchObject({
            name: 'Amoxicillin',
            dosage: '250 mg',
            frequency: 'Every 12 hours',
            startDate: '2099-10-10',
            plannedEndDate: '2099-10-17',
            notes: 'Give with food',
            recordedByAccountId: ownerId,
        });
        expect(collaboratorRecord.recordedByAccountId).toBe(collaboratorId);
    });

    it('allows concurrent identical records without deduplication', async () => {
        const records = await Promise.all([create(), create(), create(collaboratorId)]);

        expect(new Set(records.map((record) => record.id)).size).toBe(3);
        expect(await rows()).toHaveLength(3);
    });

    it('hides missing, archived, inactive and unjoined pets before semantic validation', async () => {
        const invalid = {
            petId,
            name: '',
            dosage: '',
            startDate: 'bad',
            authenticatedAccountId: outsiderId,
        };

        await expect(recordPetMedication.execute(invalid)).rejects.toThrow(PetNotFoundError);
        await expect(
            recordPetMedication.execute({
                ...invalid,
                petId: randomUUID(),
                authenticatedAccountId: ownerId,
            }),
        ).rejects.toThrow(PetNotFoundError);
        await database.connection
            .update(petMemberships)
            .set({ status: 'INACTIVE' })
            .where(eq(petMemberships.id, collaboratorMembershipId));
        await expect(
            recordPetMedication.execute({ ...invalid, authenticatedAccountId: collaboratorId }),
        ).rejects.toThrow(PetNotFoundError);
        await changeAccess('archive');
        await expect(
            recordPetMedication.execute({ ...invalid, authenticatedAccountId: ownerId }),
        ).rejects.toThrow(PetNotFoundError);
        expect(await rows()).toHaveLength(0);
    });

    it.each([
        [{ name: '' }, InvalidMedicationNameError],
        [{ dosage: '' }, InvalidMedicationDosageError],
        [{ frequency: '' }, InvalidMedicationFrequencyError],
        [{ startDate: '2026-02-29' }, InvalidMedicationStartDateError],
        [{ plannedEndDate: 'bad' }, InvalidMedicationPlannedEndDateError],
        [
            { startDate: '2099-10-17', plannedEndDate: '2099-10-10' },
            InvalidMedicationPlannedEndDateError,
        ],
        [{ notes: '' }, InvalidMedicationNotesError],
    ])(
        'validates semantic information after access and rolls back failures',
        async (information, ErrorClass) => {
            await expect(
                recordPetMedication.execute({
                    petId,
                    authenticatedAccountId: ownerId,
                    name: 'Amoxicillin',
                    ...information,
                }),
            ).rejects.toThrow(ErrorClass);
            expect(await rows()).toHaveLength(0);
            await expect(create()).resolves.toMatchObject({ petId });
        },
    );

    it('persists unknown fields, independently known dates and inclusive civil boundaries', async () => {
        const information = [
            {},
            { dosage: null, frequency: null, startDate: null, plannedEndDate: null, notes: null },
            { startDate: '2099-10-10' },
            { plannedEndDate: '2099-10-17' },
            { startDate: '2099-10-10', plannedEndDate: '2099-10-10' },
            { startDate: '0001-01-01', plannedEndDate: '9999-12-31' },
        ];

        for (const values of information) {
            const record = await recordPetMedication.execute({
                petId,
                authenticatedAccountId: ownerId,
                name: 'Amoxicillin',
                ...values,
            });
            const persisted = (await rows()).find((row) => row.id === record.id);

            expect(persisted).toMatchObject(record);
            expect(record).toMatchObject({
                dosage: null,
                frequency: null,
                notes: null,
                startDate: 'startDate' in values ? values.startDate : null,
                plannedEndDate: 'plannedEndDate' in values ? values.plannedEndDate : null,
            });
        }
    });

    it('enforces database text, calendar, civil range, interval and foreign key constraints', async () => {
        const values = {
            id: randomUUID(),
            petId,
            name: 'Amoxicillin',
            recordedByAccountId: ownerId,
        };
        const invalidValues = [
            { name: ' ' },
            { name: '🐕'.repeat(256) },
            { dosage: ' ' },
            { dosage: '🐕'.repeat(2001) },
            { frequency: ' ' },
            { frequency: '🐕'.repeat(2001) },
            { notes: ' ' },
            { notes: '🐕'.repeat(2001) },
            { startDate: '2026-02-29' },
            { plannedEndDate: '2026-04-31' },
            { startDate: '10000-01-01' },
            { plannedEndDate: '10000-01-01' },
            { startDate: '0001-01-01 BC' },
            { plannedEndDate: '0001-01-01 BC' },
            { startDate: 'infinity' },
            { plannedEndDate: '-infinity' },
            { startDate: '2099-10-17', plannedEndDate: '2099-10-10' },
            { petId: randomUUID() },
            { recordedByAccountId: randomUUID() },
        ];

        for (const invalid of invalidValues) {
            await expect(
                database.connection.insert(healthPetMedications).values({ ...values, ...invalid }),
            ).rejects.toThrow();
        }

        expect(await rows()).toHaveLength(0);
        await database.connection.insert(healthPetMedications).values({
            ...values,
            name: '🐕'.repeat(255),
            dosage: '🐕'.repeat(2000),
            frequency: '🐕'.repeat(2000),
            notes: '🐕'.repeat(2000),
            recordedByAccountId: outsiderId,
        });
        await expect(
            database.connection.delete(accounts).where(eq(accounts.id, outsiderId)),
        ).rejects.toThrow();
        await database.connection.delete(petMemberships).where(eq(petMemberships.petId, petId));
        await expect(database.connection.delete(pets).where(eq(pets.id, petId))).rejects.toThrow();
    });

    it.each(['id', 'pet_id', 'name', 'recorded_by_account_id'] as const)(
        'enforces required column %s at the database boundary',
        async (column) => {
            const values = {
                id: randomUUID(),
                pet_id: petId,
                name: 'Amoxicillin',
                recorded_by_account_id: ownerId,
            };

            values[column] = null as unknown as string;
            await expect(
                database.connection.execute(
                    sql`INSERT INTO health_pet_medications (id, pet_id, name, recorded_by_account_id) VALUES (${values.id}, ${values.pet_id}, ${values.name}, ${values.recorded_by_account_id})`,
                ),
            ).rejects.toThrow();
            expect(await rows()).toHaveLength(0);
        },
    );

    it('rolls back a real failed INSERT and releases authorization locks', async () => {
        const original = await create();
        const generate: () => PetMedicationId = PetMedicationId.generate;

        PetMedicationId.generate = (): PetMedicationId => PetMedicationId.from(original.id);

        try {
            await expect(create()).rejects.toThrow();
            expect(await rows()).toHaveLength(1);
        } finally {
            PetMedicationId.generate = generate;
        }

        await expect(create(collaboratorId)).resolves.toMatchObject({ petId });
        expect(await rows()).toHaveLength(2);
    });

    it('reuses the timestamp trigger and preserves records through Archive and Restore', async () => {
        const record = await create();
        const original = (await rows())[0];

        await database.connection
            .update(healthPetMedications)
            .set({ notes: 'Corrected via SQL', updatedAt: new Date('2000-01-01T00:00:00Z') })
            .where(eq(healthPetMedications.id, record.id));
        const updated = (await rows())[0];

        expect(updated?.createdAt).toEqual(original?.createdAt);
        expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(
            original?.updatedAt.getTime() ?? 0,
        );
        expect(updated?.updatedAt.toISOString()).not.toBe('2000-01-01T00:00:00.000Z');
        await changeAccess('archive');
        expect((await rows())[0]).toEqual(updated);
        await application.get(RestorePet).execute({ petId, requesterAccountId: ownerId });
        expect((await rows())[0]).toEqual(updated);
    });

    it('locks Pet before waiting for requester Membership', async () => {
        const acquired: Barrier = barrier();
        const released: Barrier = barrier();
        let blockerBackendId: number = 0;
        const blocker = database.connection.transaction(async (transaction) => {
            const backendRows = await transaction.execute(sql`SELECT pg_backend_pid() AS id`);

            blockerBackendId = Number(backendRows[0].id);
            await transaction.execute(sql`SET LOCAL statement_timeout = '8000ms'`);
            await transaction
                .select()
                .from(petMemberships)
                .where(eq(petMemberships.id, collaboratorMembershipId))
                .for('update');
            acquired.release();
            await released.promise;
        });

        await acquired.promise;
        const recording = settle(create(collaboratorId));
        let hasObservedMembershipWait: boolean = false;

        try {
            const deadline: number = Date.now() + 5000;

            while (Date.now() < deadline) {
                const waitingRows = await database.connection.execute(
                    sql`SELECT pid FROM pg_stat_activity WHERE ${blockerBackendId} = ANY(pg_blocking_pids(pid)) AND wait_event_type = 'Lock' AND query ILIKE '%"pet_memberships"%'`,
                );

                if (waitingRows.length > 0) {
                    hasObservedMembershipWait = true;
                    break;
                }

                await new Promise<void>((resolve) => setImmediate(resolve));
            }

            expect(hasObservedMembershipWait).toBe(true);
            await expect(
                database.connection.transaction(async (transaction) => {
                    await transaction.execute(
                        sql`SELECT id FROM pets WHERE id = ${petId} FOR UPDATE NOWAIT`,
                    );
                }),
            ).rejects.toThrow();
        } finally {
            released.release();
            await blocker;
            await recording;
        }

        expect((await recording).error).toBeUndefined();
        expect(await rows()).toHaveLength(1);
    });
    it.each(['archive', 'leave', 'remove'] as const)(
        'serializes %s before Record Medication',
        async (action: AccessChange) => {
            const [change, medication] = await race(
                () => changeAccess(action),
                () =>
                    recordPetMedication.execute({
                        petId,
                        authenticatedAccountId: collaboratorId,
                        name: '',
                        startDate: 'bad',
                    }),
            );

            expect(change.error).toBeUndefined();
            expect(medication.error).toBeInstanceOf(PetNotFoundError);
            expect(await rows()).toHaveLength(0);
        },
    );
    it.each(['archive', 'leave', 'remove'] as const)(
        'serializes Record Medication before %s',
        async (action: AccessChange) => {
            const [medication, change] = await race(
                () => create(collaboratorId),
                () => changeAccess(action),
            );

            expect(change.error).toBeUndefined();
            expect(medication.error).toBeUndefined();
            expect(medication.value).toMatchObject({
                petId,
                recordedByAccountId: collaboratorId,
            });
            expect(await rows()).toHaveLength(1);
            expect((await rows())[0]?.recordedByAccountId).toBe(collaboratorId);
        },
    );
});
