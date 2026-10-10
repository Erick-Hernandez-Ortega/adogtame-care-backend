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
import {
    InvalidMedicalConditionNameError,
    InvalidMedicalConditionDiagnosedDateError,
    InvalidMedicalConditionNotesError,
} from '../../src/health/application/record-pet-medical-condition/record-pet-medical-condition';
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

describe('UpdatePetMedicalCondition with PostgreSQL (integration)', () => {
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
            sql`SELECT id, pet_id, recorded_by_account_id, name, status, diagnosed_date, notes, created_at::text AS created_at, updated_at::text AS updated_at, xmin::text AS version, ctid::text AS location FROM health_pet_medical_conditions WHERE id = ${conditionId}`,
        );

        return results[0];
    }

    it.each(['OWNER', 'COLLABORATOR'] as const)(
        'allows active %s to correct another author and preserves identity',
        async (role) => {
            const created = await create(role === 'OWNER' ? collaboratorId : ownerId);
            const before = await physicalRow(created.id);

            clockCalls = 0;
            const corrected = await update(
                created.id,
                {
                    name: ' Osteoarthritis ',
                    diagnosedDate: '2026-02-10',
                    notes: ' Corrected ',
                },
                role === 'OWNER' ? ownerId : collaboratorId,
            );

            expect(corrected).toEqual({
                ...created,
                name: 'Osteoarthritis',
                diagnosedDate: '2026-02-10',
                notes: 'Corrected',
            });
            expect(clockCalls).toBe(1);
            const after = await physicalRow(created.id);

            expect(after).toMatchObject({
                id: before.id,
                pet_id: before.pet_id,
                status: before.status,
                recorded_by_account_id: before.recorded_by_account_id,
                created_at: before.created_at,
            });
            expect(after.version).not.toBe(before.version);
        },
    );

    it.each(['ACTIVE', 'RESOLVED'])(
        'corrects %s, skips physical no-ops and preserves independent duplicates',
        async (status: string) => {
            const conditionId: string = randomUUID();

            await database.connection.insert(healthPetMedicalConditions).values({
                id: conditionId,
                petId,
                name: 'Arthritis',
                status,
                diagnosedDate: '2026-02-10',
                notes: 'Original notes',
                recordedByAccountId: ownerId,
                createdAt: new Date('2000-01-01T00:00:00Z'),
                updatedAt: new Date('2000-01-01T00:00:00Z'),
            });
            const before = await physicalRow(conditionId);

            for (const patch of [
                { name: ' Arthritis ' },
                { diagnosedDate: '2026-02-10' },
                { notes: ' Original notes ' },
                {
                    name: ' Arthritis ',
                    diagnosedDate: '2026-02-10',
                    notes: ' Original notes ',
                },
            ]) {
                expect(await update(conditionId, patch)).toMatchObject({ status });
                expect(await physicalRow(conditionId)).toEqual(before);
            }

            expect(await update(conditionId, { name: ' Osteoarthritis ' })).toMatchObject({
                name: 'Osteoarthritis',
                diagnosedDate: '2026-02-10',
                notes: 'Original notes',
                status,
            });
            const changed = await physicalRow(conditionId);

            expect(changed.created_at).toBe(before.created_at);
            expect(changed.updated_at).not.toBe(before.updated_at);
            expect(changed.version).not.toBe(before.version);
            expect(await update(conditionId, { diagnosedDate: null })).toMatchObject({
                diagnosedDate: null,
                notes: 'Original notes',
                status,
            });
            expect(await update(conditionId, { notes: null })).toMatchObject({
                diagnosedDate: null,
                notes: null,
                status,
            });
            const cleared = await physicalRow(conditionId);

            await update(conditionId, { diagnosedDate: null, notes: null });
            expect(await physicalRow(conditionId)).toEqual(cleared);
            await update(conditionId, { diagnosedDate: '2026-03-14' });
            await create();
            await update(conditionId, {
                name: 'Arthritis',
                diagnosedDate: null,
                notes: 'Monitored periodically.',
            });
            expect(await rows()).toHaveLength(2);
        },
    );

    it('preserves a persisted date beyond today when omitted but rejects an explicit future date', async () => {
        const conditionId: string = randomUUID();

        await database.connection.insert(healthPetMedicalConditions).values({
            id: conditionId,
            petId,
            name: 'Arthritis',
            status: 'RESOLVED',
            diagnosedDate: '2027-01-01',
            recordedByAccountId: ownerId,
        });
        expect(
            await update(conditionId, { notes: 'Corrected historical information' }),
        ).toMatchObject({ status: 'RESOLVED', diagnosedDate: '2027-01-01' });
        const before = await physicalRow(conditionId);

        await update(conditionId, { name: ' Arthritis ' });
        expect(await physicalRow(conditionId)).toEqual(before);
        await expect(update(conditionId, { diagnosedDate: '2027-01-01' })).rejects.toThrow(
            InvalidMedicalConditionDiagnosedDateError,
        );
        expect(await physicalRow(conditionId)).toEqual(before);
    });

    it('allows another member to correct after the author leaves', async () => {
        const created = await create(collaboratorId);

        await changeAccess('leave');
        expect(await update(created.id)).toMatchObject({
            recordedByAccountId: collaboratorId,
        });
        await expect(update(created.id, { name: '' }, collaboratorId)).rejects.toThrow(
            PetNotFoundError,
        );
    });

    it('authorizes access before target resolution and semantic validation without consulting Clock on missing access/target', async () => {
        const created = await create();
        const otherConditionId: string = randomUUID();

        await database.connection.insert(healthPetMedicalConditions).values({
            id: otherConditionId,
            petId: otherPetId,
            name: 'Other',
            recordedByAccountId: ownerId,
        });
        clockCalls = 0;
        await expect(update(created.id, { name: '' }, outsiderId)).rejects.toThrow(
            PetNotFoundError,
        );
        await expect(update(created.id, { petId: randomUUID(), name: '' })).rejects.toThrow(
            PetNotFoundError,
        );
        await expect(update(randomUUID(), { name: '' })).rejects.toThrow(
            PetMedicalConditionNotFoundError,
        );
        await expect(update(otherConditionId, { name: '' })).rejects.toThrow(
            PetMedicalConditionNotFoundError,
        );
        await changeAccess('leave');
        await expect(update(created.id, { name: '' }, collaboratorId)).rejects.toThrow(
            PetNotFoundError,
        );
        await changeAccess('archive');
        await expect(update(created.id, { name: '' })).rejects.toThrow(PetNotFoundError);
        expect(clockCalls).toBe(0);
    });

    it.each([
        [{ name: '' }, InvalidMedicalConditionNameError],
        [{ notes: ' ' }, InvalidMedicalConditionNotesError],
        [{ diagnosedDate: '2026-02-29' }, InvalidMedicalConditionDiagnosedDateError],
        [{ diagnosedDate: '2026-03-15' }, InvalidMedicalConditionDiagnosedDateError],
        [{ name: 'Changed', notes: ' ' }, InvalidMedicalConditionNotesError],
    ])('rolls back semantic error %j and releases locks', async (patch, errorClass) => {
        const created = await create();
        const before = await physicalRow(created.id);

        await expect(update(created.id, patch)).rejects.toThrow(errorClass);
        expect(await physicalRow(created.id)).toEqual(before);
        await expect(update(created.id)).resolves.toMatchObject({
            name: 'Osteoarthritis',
        });
    });

    it('List reflects corrected values and diagnosis date ordering', async () => {
        const first = await create();
        const second = await create();

        await update(first.id, { diagnosedDate: '2026-02-10' });
        await update(second.id, { diagnosedDate: '2026-03-14', notes: null });
        const list = (): Promise<unknown> =>
            application
                .get(ListPetMedicalConditions)
                .execute({ petId, authenticatedAccountId: ownerId });

        expect(await list()).toMatchObject({
            items: [
                { id: second.id, diagnosedDate: '2026-03-14', notes: null },
                { id: first.id, diagnosedDate: '2026-02-10' },
            ],
        });
        await update(second.id, { diagnosedDate: null });
        expect(await list()).toMatchObject({
            items: [{ id: first.id }, { id: second.id, diagnosedDate: null }],
        });
    });

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
        const correction = settle(update(created.id, { diagnosedDate: '2026-03-15' }));

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
            value: { diagnosedDate: '2026-03-15' },
        });
        expect(clockCalls).toBe(1);
    });
    it.each([false, true])(
        'preserves both concurrent patches without lost updates, reverse=%s',
        async (isReverse: boolean) => {
            const created = await create(ownerId, null);
            const nameCorrection = (): Promise<unknown> =>
                update(created.id, { name: 'Osteoarthritis' });
            const notesCorrection = (): Promise<unknown> =>
                update(created.id, { notes: 'Monitored periodically' }, collaboratorId);
            const [first, second] = await race(
                isReverse ? notesCorrection : nameCorrection,
                isReverse ? nameCorrection : notesCorrection,
            );

            expect(first.error).toBeUndefined();
            expect(second.error).toBeUndefined();
            expect(second.value).toMatchObject({
                name: 'Osteoarthritis',
                notes: 'Monitored periodically',
            });
            expect(await physicalRow(created.id)).toMatchObject({
                name: 'Osteoarthritis',
                notes: 'Monitored periodically',
                recorded_by_account_id: ownerId,
            });
        },
    );

    it.each(['archive', 'leave', 'remove'] as const)(
        'rejects Update after %s wins the Pet lock',
        async (action: AccessChange) => {
            const created = await create();
            const before = await physicalRow(created.id);
            const [change, correction] = await race(
                () => changeAccess(action),
                () => update(created.id, { name: 'Osteoarthritis' }, collaboratorId),
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
                () => update(created.id, { name: 'Osteoarthritis' }, collaboratorId),
                () => changeAccess(action),
            );

            expect(correction.error).toBeUndefined();
            expect(correction.value).toMatchObject({
                name: 'Osteoarthritis',
                recordedByAccountId: ownerId,
            });
            expect(change.error).toBeUndefined();
            expect(await physicalRow(created.id)).toMatchObject({
                name: 'Osteoarthritis',
                recorded_by_account_id: ownerId,
            });
        },
    );

    it.each([false, true])(
        'serializes Restore and Update without retry, updateFirst=%s',
        async (isUpdateFirst: boolean) => {
            const created = await create();

            await changeAccess('archive');
            const before = await physicalRow(created.id);
            const correction = (): Promise<unknown> => update(created.id);
            const restoration = (): Promise<void> => changeAccess('restore');
            const [first, second] = await race(
                isUpdateFirst ? correction : restoration,
                isUpdateFirst ? restoration : correction,
            );

            if (isUpdateFirst) {
                expect(first.error).toBeInstanceOf(PetNotFoundError);
                expect(second.error).toBeUndefined();
                expect(await physicalRow(created.id)).toEqual(before);
            } else {
                expect(first.error).toBeUndefined();
                expect(second.error).toBeUndefined();
                expect(second.value).toMatchObject({ name: 'Osteoarthritis' });
            }
        },
    );
});
