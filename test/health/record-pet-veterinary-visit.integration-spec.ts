import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import {
    PetNotFoundError,
    RecordPetVeterinaryVisit,
} from '../../src/health/application/record-pet-veterinary-visit/record-pet-veterinary-visit';
import { healthPetVeterinaryVisits } from '../../src/health/infrastructure/persistence/drizzle/health.schema';
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
import { DrizzlePetVeterinaryVisitRepository } from '../../src/health/infrastructure/persistence/drizzle/drizzle-pet-veterinary-visit.repository';
import { VisitDate } from '../../src/health/domain/visit-date/visit-date';
import { HEALTH_CLOCK } from '../../src/health/application/time/clock';
import { InvalidVeterinaryVisitDateError } from '../../src/health/application/record-pet-veterinary-visit/record-pet-veterinary-visit';
import { VeterinaryVisitReason } from '../../src/health/domain/veterinary-visit-reason/veterinary-visit-reason';
import {
    PetVeterinaryVisit,
    PetId,
    RecordedByAccountId,
} from '../../src/health/domain/pet-veterinary-visit/pet-veterinary-visit';

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

describe('RecordPetVeterinaryVisit with PostgreSQL (integration)', () => {
    let application: INestApplicationContext;
    let database: DatabaseService;
    let recordPetVeterinaryVisit: RecordPetVeterinaryVisit;
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
        recordPetVeterinaryVisit = application.get(RecordPetVeterinaryVisit);
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
            name: 'Veterinary visit pet',
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
            .delete(healthPetVeterinaryVisits)
            .where(eq(healthPetVeterinaryVisits.petId, petId));
        await database.connection.delete(petMemberships).where(eq(petMemberships.petId, petId));
        await database.connection.delete(pets).where(eq(pets.id, petId));

        for (const accountId of [ownerId, collaboratorId, outsiderId]) {
            await database.connection.delete(accounts).where(eq(accounts.id, accountId));
        }
    });

    function create(
        accountId: string = ownerId,
        observations: string | null = '  Recurring seizures.  ',
    ) {
        return recordPetVeterinaryVisit.execute({
            petId,
            reason: '  Epilepsy  ',
            visitDate: '2026-03-14',
            diagnosis: '  Healthy  ',
            observations,
            authenticatedAccountId: accountId,
        });
    }

    function rows() {
        return database.connection
            .select()
            .from(healthPetVeterinaryVisits)
            .where(eq(healthPetVeterinaryVisits.petId, petId));
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

    it('persists exact normalized data for both roles, nullable observations, timestamps, and duplicates', async () => {
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
            reason: 'Epilepsy',
            visitDate: '2026-03-14',
            diagnosis: 'Healthy',
            observations: 'Recurring seizures.',
            petId,
            recordedByAccountId: ownerId,
        });
        expect(collaboratorRecord).toMatchObject({
            observations: null,
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
            recordPetVeterinaryVisit.execute({
                petId: randomUUID(),
                reason: 'Epilepsy',
                visitDate: '2026-03-14',
                authenticatedAccountId: ownerId,
            }),
        ).rejects.toThrow(PetNotFoundError);
        expect(await rows()).toHaveLength(0);
    });

    it('enforces structural constraints and restricts foreign-key deletion', async () => {
        const values = {
            id: randomUUID(),
            petId,
            reason: 'Epilepsy',
            visitDate: '2026-03-14',
            observations: null,
            recordedByAccountId: ownerId,
        };

        for (const invalidValues of [
            { ...values, reason: ' ' },
            { ...values, reason: '🐕'.repeat(256) },
            { ...values, visitDate: '2026-02-29' },
            { ...values, diagnosis: ' ' },
            { ...values, diagnosis: '🐕'.repeat(2001) },
            { ...values, visitDate: '0001-01-01 BC' },
            { ...values, visitDate: '10000-01-01' },
            { ...values, observations: ' ' },
            { ...values, observations: '🐕'.repeat(5001) },
            { ...values, petId: randomUUID() },
            { ...values, recordedByAccountId: randomUUID() },
        ]) {
            await expect(
                database.connection.insert(healthPetVeterinaryVisits).values(invalidValues),
            ).rejects.toThrow();
        }

        expect(await rows()).toHaveLength(0);
        await database.connection.insert(healthPetVeterinaryVisits).values({
            ...values,
            reason: '🐕'.repeat(255),
            diagnosis: '🐕'.repeat(2000),
            observations: '🐕'.repeat(5000),
            recordedByAccountId: outsiderId,
        });
        await expect(
            database.connection.delete(accounts).where(eq(accounts.id, outsiderId)),
        ).rejects.toThrow();
        await database.connection.delete(petMemberships).where(eq(petMemberships.petId, petId));
        await expect(database.connection.delete(pets).where(eq(pets.id, petId))).rejects.toThrow();
    });

    it('authorizes the explicit requester independently from authorship', async () => {
        const visit: PetVeterinaryVisit = PetVeterinaryVisit.create({
            petId: PetId.from(petId),
            reason: VeterinaryVisitReason.from('Epilepsy'),
            visitDate: VisitDate.from('2026-03-14', '2026-03-14'),
            recordedByAccountId: RecordedByAccountId.from(outsiderId),
        });
        const repository: DrizzlePetVeterinaryVisitRepository = application.get(
            DrizzlePetVeterinaryVisitRepository,
        );

        await expect(repository.createIfPetWritable(visit, outsiderId)).resolves.toBe(
            'PET_NOT_FOUND',
        );
        expect(await rows()).toHaveLength(0);
        await expect(repository.createIfPetWritable(visit, ownerId)).resolves.toBe('CREATED');
        expect((await rows())[0]?.recordedByAccountId).toBe(outsiderId);
    });

    it('rolls back a failed insert and releases authorization locks', async () => {
        const visit: PetVeterinaryVisit = PetVeterinaryVisit.create({
            petId: PetId.from(petId),
            reason: VeterinaryVisitReason.from('Epilepsy'),
            visitDate: VisitDate.from('2026-03-14', '2026-03-14'),
            recordedByAccountId: RecordedByAccountId.from(randomUUID()),
        });

        await expect(
            application
                .get(DrizzlePetVeterinaryVisitRepository)
                .createIfPetWritable(visit, ownerId),
        ).rejects.toThrow();
        expect(await rows()).toHaveLength(0);
        await expect(create()).resolves.toMatchObject({ petId });
    });

    it('reuses the existing timestamp trigger', async () => {
        const record = await create();
        const original = (await rows())[0];

        await database.connection
            .update(healthPetVeterinaryVisits)
            .set({
                observations: 'Corrected via SQL',
                updatedAt: new Date('2000-01-01T00:00:00Z'),
            })
            .where(eq(healthPetVeterinaryVisits.id, record.id));
        const updated = (await rows())[0];

        expect(updated?.createdAt).toEqual(original?.createdAt);
        expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(
            original?.updatedAt.getTime() ?? 0,
        );
        expect(updated?.updatedAt.toISOString()).not.toBe('2000-01-01T00:00:00.000Z');
    });

    it('preserves visit data and timestamps through Archive and Restore', async () => {
        await create();
        const original = await rows();

        await changeAccess('archive');
        expect(await rows()).toEqual(original);
        await application.get(RestorePet).execute({ petId, requesterAccountId: ownerId });
        expect(await rows()).toEqual(original);
    });

    it('stores absent optional text as null and rejects future dates before inserting', async () => {
        const visit = await recordPetVeterinaryVisit.execute({
            petId,
            reason: 'Checkup',
            visitDate: '2026-03-14',
            authenticatedAccountId: ownerId,
        });

        expect(visit).toMatchObject({ diagnosis: null, observations: null });

        for (const visitDate of ['2026-03-15', '2026-02-29']) {
            await expect(
                recordPetVeterinaryVisit.execute({
                    petId,
                    reason: 'Checkup',
                    visitDate,
                    authenticatedAccountId: ownerId,
                }),
            ).rejects.toThrow(InvalidVeterinaryVisitDateError);
        }

        expect(await rows()).toHaveLength(1);
    });

    it('enforces required reason and date columns at the database boundary', async () => {
        for (const columns of [sql`NULL, DATE '2026-03-14'`, sql`'Checkup', NULL`]) {
            await expect(
                database.connection.execute(
                    sql`INSERT INTO health_pet_veterinary_visits (id, pet_id, reason, visit_date, recorded_by_account_id) VALUES (${randomUUID()}, ${petId}, ${columns}, ${ownerId})`,
                ),
            ).rejects.toThrow();
        }

        expect(await rows()).toHaveLength(0);
    });

    it.each(['archive', 'leave', 'remove'] as const)(
        'serializes %s before Record Veterinary Visit',
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
        'serializes Record Veterinary Visit before %s',
        async (action: AccessChange) => {
            const [visit, change] = await race(
                () => create(collaboratorId),
                () => changeAccess(action),
            );

            expect(change.error).toBeUndefined();
            expect(visit.error).toBeUndefined();
            expect(visit.value).toMatchObject({
                petId,
                recordedByAccountId: collaboratorId,
            });
            expect(await rows()).toHaveLength(1);
            expect((await rows())[0]?.recordedByAccountId).toBe(collaboratorId);
        },
    );
});
