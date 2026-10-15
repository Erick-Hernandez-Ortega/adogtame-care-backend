import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import {
    CreateCareRoutine,
    PetNotFoundError,
} from '../../src/care/application/create-care-routine/create-care-routine';
import {
    CareRoutine,
    PetId,
    RecordedByAccountId,
} from '../../src/care/domain/care-routine/care-routine';
import { CareRoutineType } from '../../src/care/domain/routine-type/routine-type';
import { RoutineTitle } from '../../src/care/domain/routine-title/routine-title';
import { RoutineFrequency } from '../../src/care/domain/routine-frequency/routine-frequency';
import { RoutineTimezone } from '../../src/care/domain/routine-timezone/routine-timezone';
import { DrizzleCareRoutineRepository } from '../../src/care/infrastructure/persistence/drizzle/drizzle-care-routine.repository';
import { careRoutines } from '../../src/care/infrastructure/persistence/drizzle/care.schema';
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

describe('CreateCareRoutine with PostgreSQL (integration)', () => {
    let application: INestApplicationContext;
    let database: DatabaseService;
    let createCareRoutine: CreateCareRoutine;
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
        createCareRoutine = application.get(CreateCareRoutine);
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
    });

    afterEach(async () => {
        await database.connection.delete(careRoutines).where(eq(careRoutines.petId, petId));
        await database.connection.delete(petMemberships).where(eq(petMemberships.petId, petId));
        await database.connection.delete(pets).where(eq(pets.id, petId));

        for (const accountId of [ownerId, collaboratorId, outsiderId]) {
            await database.connection.delete(accounts).where(eq(accounts.id, accountId));
        }
    });

    function create(accountId: string = ownerId, instructions: string | null = '  One portion  ') {
        return createCareRoutine.execute({
            petId,
            type: 'FEEDING',
            title: '  Breakfast  ',
            instructions,
            frequency: {
                period: 'WEEKLY',
                timesPerPeriod: 3,
                suggestedTimes: ['08:00'],
                weekdays: ['MONDAY'],
            },
            timezone: 'America/Mexico_City',
            authenticatedAccountId: accountId,
        });
    }

    function rows() {
        return database.connection.select().from(careRoutines).where(eq(careRoutines.petId, petId));
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

    it('persists normalized fields, nullable instructions, authorship, timestamps and duplicates', async () => {
        const first = await create();
        const second = await create(collaboratorId, null);
        const duplicate = await create();
        const persisted = await rows();

        expect(new Set([first.id, second.id, duplicate.id]).size).toBe(3);
        expect(persisted).toHaveLength(3);

        for (const record of [first, second, duplicate]) {
            const row = persisted.find((candidate) => candidate.id === record.id);

            expect(row).toEqual({
                id: record.id,
                petId,
                type: 'FEEDING',
                title: 'Breakfast',
                instructions: record.instructions,
                frequencyPeriod: 'WEEKLY',
                timesPerPeriod: 3,
                suggestedTimes: ['08:00'],
                weekdays: ['MONDAY'],
                timezone: 'America/Mexico_City',
                recordedByAccountId: record.recordedByAccountId,
                createdAt: expect.any(Date) as Date,
                updatedAt: expect.any(Date) as Date,
            });
            expect(row?.createdAt).toEqual(row?.updatedAt);
        }
    });

    it('hides missing, archived, inactive and unjoined pets without inserting', async () => {
        await expect(create(outsiderId)).rejects.toThrow(PetNotFoundError);
        await database.connection
            .update(petMemberships)
            .set({ status: 'INACTIVE' })
            .where(eq(petMemberships.id, collaboratorMembershipId));
        await expect(create(collaboratorId)).rejects.toThrow(PetNotFoundError);
        await changeAccess('archive');
        await expect(create()).rejects.toThrow(PetNotFoundError);
        await expect(
            createCareRoutine.execute({
                petId: randomUUID(),
                authenticatedAccountId: ownerId,
                type: 'WALK',
                title: 'Walk',
                frequency: { period: 'DAILY', timesPerPeriod: 1 },
                timezone: 'UTC',
            }),
        ).rejects.toThrow(PetNotFoundError);
        expect(await rows()).toHaveLength(0);
    });

    function routine(authorId: string): CareRoutine {
        return CareRoutine.create({
            petId: PetId.from(petId),
            type: CareRoutineType.from('WALK'),
            title: RoutineTitle.from('Walk'),
            frequency: RoutineFrequency.from({ period: 'DAILY', timesPerPeriod: 1 }),
            timezone: RoutineTimezone.from('UTC'),
            recordedByAccountId: RecordedByAccountId.from(authorId),
        });
    }

    it('checks the explicit requester independently from authorship', async () => {
        const repository = application.get(DrizzleCareRoutineRepository);
        const record: CareRoutine = routine(outsiderId);

        await expect(repository.createIfPetWritable(record, outsiderId)).resolves.toBe(
            'PET_NOT_FOUND',
        );
        expect(await rows()).toHaveLength(0);
        await expect(repository.createIfPetWritable(record, ownerId)).resolves.toBe('CREATED');
        expect((await rows())[0]?.recordedByAccountId).toBe(outsiderId);
    });

    it('rolls back failed inserts and releases locks', async () => {
        await expect(
            application
                .get(DrizzleCareRoutineRepository)
                .createIfPetWritable(routine(randomUUID()), ownerId),
        ).rejects.toThrow();
        expect(await rows()).toHaveLength(0);
        await expect(create()).resolves.toMatchObject({ petId });
    });

    it('preserves routines and timestamps through Archive and Restore', async () => {
        await create();
        const original = await rows();

        await changeAccess('archive');
        expect(await rows()).toEqual(original);
        await application.get(RestorePet).execute({ petId, requesterAccountId: ownerId });
        expect(await rows()).toEqual(original);
    });

    it.each(['archive', 'leave', 'remove'] as const)(
        'serializes %s before Create Routine',
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
        'serializes Create Routine before %s',
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
