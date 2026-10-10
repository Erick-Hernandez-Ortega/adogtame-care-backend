import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
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
import { DrizzlePetMedicalConditionRepository } from '../../src/health/infrastructure/persistence/drizzle/drizzle-pet-medical-condition.repository';
import { DiagnosedDate } from '../../src/health/domain/diagnosed-date/diagnosed-date';
import { HEALTH_CLOCK } from '../../src/health/application/time/clock';
import { InvalidMedicalConditionDiagnosedDateError } from '../../src/health/application/record-pet-medical-condition/record-pet-medical-condition';
import { MedicalConditionName } from '../../src/health/domain/medical-condition-name/medical-condition-name';
import {
    PetMedicalCondition,
    PetId,
    RecordedByAccountId,
} from '../../src/health/domain/pet-medical-condition/pet-medical-condition';

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

describe('RecordPetMedicalCondition with PostgreSQL (integration)', () => {
    let application: INestApplicationContext;
    let database: DatabaseService;
    let recordPetMedicalCondition: RecordPetMedicalCondition;
    let petId: string;
    let ownerId: string;
    let collaboratorId: string;
    let outsiderId: string;
    let collaboratorMembershipId: string;

    beforeAll(async () => {
        const fixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        })
            .overrideProvider(HEALTH_CLOCK)
            .useValue({ now: (): Date => new Date('2026-03-14T00:30:00Z') })
            .compile();

        application = fixture;
        database = application.get(DatabaseService);
        recordPetMedicalCondition = application.get(RecordPetMedicalCondition);
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
            name: 'Medical condition pet',
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
            .delete(healthPetMedicalConditions)
            .where(eq(healthPetMedicalConditions.petId, petId));
        await database.connection.delete(petMemberships).where(eq(petMemberships.petId, petId));
        await database.connection.delete(pets).where(eq(pets.id, petId));

        for (const accountId of [ownerId, collaboratorId, outsiderId]) {
            await database.connection.delete(accounts).where(eq(accounts.id, accountId));
        }
    });

    function create(accountId: string = ownerId, notes: string | null = '  Recurring seizures.  ') {
        return recordPetMedicalCondition.execute({
            petId,
            name: '  Epilepsy  ',
            diagnosedDate: '2026-03-14',
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

    it('persists exact normalized data for both roles, nullable notes, timestamps, and duplicates', async () => {
        const ownerRecord = await create();
        const collaboratorRecord = await create(collaboratorId, null);
        const duplicate = await create();

        expect(new Set([ownerRecord.id, collaboratorRecord.id, duplicate.id]).size).toBe(3);
        const persisted = await rows();

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
            name: 'Epilepsy',
            status: 'ACTIVE',
            diagnosedDate: '2026-03-14',
            notes: 'Recurring seizures.',
            petId,
            recordedByAccountId: ownerId,
        });
        expect(collaboratorRecord).toMatchObject({
            notes: null,
            recordedByAccountId: collaboratorId,
        });
    });

    it('hides missing, archived, inactive, and unjoined pets without inserting', async () => {
        await expect(create(outsiderId)).rejects.toThrow(PetNotFoundError);
        await database.connection
            .update(petMemberships)
            .set({ status: 'INACTIVE' })
            .where(eq(petMemberships.id, collaboratorMembershipId));
        await expect(create(collaboratorId)).rejects.toThrow(PetNotFoundError);
        await changeAccess('archive');
        await expect(create()).rejects.toThrow(PetNotFoundError);
        await expect(
            recordPetMedicalCondition.execute({
                petId: randomUUID(),
                name: 'Epilepsy',
                diagnosedDate: '2026-03-14',
                authenticatedAccountId: ownerId,
            }),
        ).rejects.toThrow(PetNotFoundError);
        expect(await rows()).toHaveLength(0);
    });

    it('enforces structural constraints and restricts foreign-key deletion', async () => {
        const values = {
            id: randomUUID(),
            petId,
            name: 'Epilepsy',
            diagnosedDate: '2026-03-14',
            notes: null,
            recordedByAccountId: ownerId,
        };

        for (const invalidValues of [
            { ...values, name: ' ' },
            { ...values, name: '🐕'.repeat(256) },
            { ...values, status: 'active' },
            { ...values, status: 'UNKNOWN' },
            { ...values, diagnosedDate: '2026-02-29' },
            { ...values, notes: ' ' },
            { ...values, notes: '🐕'.repeat(2001) },
            { ...values, petId: randomUUID() },
            { ...values, recordedByAccountId: randomUUID() },
        ]) {
            await expect(
                database.connection.insert(healthPetMedicalConditions).values(invalidValues),
            ).rejects.toThrow();
        }

        expect(await rows()).toHaveLength(0);
        await database.connection.insert(healthPetMedicalConditions).values({
            ...values,
            name: '🐕'.repeat(255),
            notes: '🐕'.repeat(2000),
            recordedByAccountId: outsiderId,
        });
        await expect(
            database.connection.delete(accounts).where(eq(accounts.id, outsiderId)),
        ).rejects.toThrow();
        await database.connection.delete(petMemberships).where(eq(petMemberships.petId, petId));
        await expect(database.connection.delete(pets).where(eq(pets.id, petId))).rejects.toThrow();
    });

    it('authorizes the explicit requester independently from authorship', async () => {
        const condition: PetMedicalCondition = PetMedicalCondition.create({
            petId: PetId.from(petId),
            name: MedicalConditionName.from('Epilepsy'),
            diagnosedDate: DiagnosedDate.from('2026-03-14', '2026-03-14'),
            recordedByAccountId: RecordedByAccountId.from(outsiderId),
        });
        const repository: DrizzlePetMedicalConditionRepository = application.get(
            DrizzlePetMedicalConditionRepository,
        );

        await expect(repository.createIfPetWritable(condition, outsiderId)).resolves.toBe(
            'PET_NOT_FOUND',
        );
        expect(await rows()).toHaveLength(0);
        await expect(repository.createIfPetWritable(condition, ownerId)).resolves.toBe('CREATED');
        expect((await rows())[0]?.recordedByAccountId).toBe(outsiderId);
    });

    it('rolls back a failed insert and releases authorization locks', async () => {
        const condition: PetMedicalCondition = PetMedicalCondition.create({
            petId: PetId.from(petId),
            name: MedicalConditionName.from('Epilepsy'),
            diagnosedDate: DiagnosedDate.from('2026-03-14', '2026-03-14'),
            recordedByAccountId: RecordedByAccountId.from(randomUUID()),
        });

        await expect(
            application
                .get(DrizzlePetMedicalConditionRepository)
                .createIfPetWritable(condition, ownerId),
        ).rejects.toThrow();
        expect(await rows()).toHaveLength(0);
        await expect(create()).resolves.toMatchObject({ petId });
    });

    it('reuses the existing timestamp trigger', async () => {
        const record = await create();
        const original = (await rows())[0];

        await database.connection
            .update(healthPetMedicalConditions)
            .set({
                notes: 'Corrected via SQL',
                updatedAt: new Date('2000-01-01T00:00:00Z'),
            })
            .where(eq(healthPetMedicalConditions.id, record.id));
        const updated = (await rows())[0];

        expect(updated?.createdAt).toEqual(original?.createdAt);
        expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(
            original?.updatedAt.getTime() ?? 0,
        );
        expect(updated?.updatedAt.toISOString()).not.toBe('2000-01-01T00:00:00.000Z');
    });

    it('preserves condition data and timestamps through Archive and Restore', async () => {
        await create();
        const original = await rows();

        await changeAccess('archive');
        expect(await rows()).toEqual(original);
        await application.get(RestorePet).execute({ petId, requesterAccountId: ownerId });
        expect(await rows()).toEqual(original);
    });

    it('stores unknown dates and notes as null and rejects future dates before inserting', async () => {
        const condition = await recordPetMedicalCondition.execute({
            petId,
            name: 'Diabetes',
            authenticatedAccountId: ownerId,
        });

        expect(condition).toMatchObject({
            diagnosedDate: null,
            notes: null,
            status: 'ACTIVE',
        });
        expect((await rows())[0]).toMatchObject({
            diagnosedDate: null,
            notes: null,
            status: 'ACTIVE',
        });

        for (const diagnosedDate of ['2026-03-15', '2026-02-29']) {
            await expect(
                recordPetMedicalCondition.execute({
                    petId,
                    name: 'Diabetes',
                    diagnosedDate,
                    authenticatedAccountId: ownerId,
                }),
            ).rejects.toThrow(InvalidMedicalConditionDiagnosedDateError);
        }

        expect(await rows()).toHaveLength(1);
    });

    it('defaults status to ACTIVE and permits RESOLVED in storage without exposing a resolve workflow', async () => {
        const values = {
            petId,
            name: 'Previous fracture',
            recordedByAccountId: ownerId,
        };

        await database.connection.insert(healthPetMedicalConditions).values([
            { ...values, id: randomUUID() },
            { ...values, id: randomUUID(), status: 'RESOLVED' },
        ]);
        expect((await rows()).map((row) => row.status).sort()).toEqual(['ACTIVE', 'RESOLVED']);
    });

    it('enforces required columns at the database boundary', async () => {
        await expect(
            database.connection.execute(
                sql`INSERT INTO health_pet_medical_conditions (id, pet_id, name, recorded_by_account_id) VALUES (${randomUUID()}, ${petId}, NULL, ${ownerId})`,
            ),
        ).rejects.toThrow();
        await expect(
            database.connection.execute(
                sql`INSERT INTO health_pet_medical_conditions (id, pet_id, name, status, recorded_by_account_id) VALUES (${randomUUID()}, ${petId}, 'Diabetes', NULL, ${ownerId})`,
            ),
        ).rejects.toThrow();
        await expect(
            database.connection.execute(
                sql`INSERT INTO health_pet_medical_conditions (id, pet_id, name, recorded_by_account_id) VALUES (${randomUUID()}, NULL, 'Diabetes', ${ownerId})`,
            ),
        ).rejects.toThrow();
        await expect(
            database.connection.execute(
                sql`INSERT INTO health_pet_medical_conditions (id, pet_id, name, recorded_by_account_id) VALUES (${randomUUID()}, ${petId}, 'Diabetes', NULL)`,
            ),
        ).rejects.toThrow();
        expect(await rows()).toHaveLength(0);
    });

    it.each(['archive', 'leave', 'remove'] as const)(
        'serializes %s before Record Medical Condition',
        async (action: AccessChange) => {
            const [change, condition] = await race(
                () => changeAccess(action),
                () => create(collaboratorId),
            );

            expect(change.error).toBeUndefined();
            expect(condition.error).toBeInstanceOf(PetNotFoundError);
            expect(await rows()).toHaveLength(0);
        },
    );
    it.each(['archive', 'leave', 'remove'] as const)(
        'serializes Record Medical Condition before %s',
        async (action: AccessChange) => {
            const [condition, change] = await race(
                () => create(collaboratorId),
                () => changeAccess(action),
            );

            expect(change.error).toBeUndefined();
            expect(condition.error).toBeUndefined();
            expect(condition.value).toMatchObject({
                petId,
                recordedByAccountId: collaboratorId,
            });
            expect(await rows()).toHaveLength(1);
            expect((await rows())[0]?.recordedByAccountId).toBe(collaboratorId);
        },
    );
});
