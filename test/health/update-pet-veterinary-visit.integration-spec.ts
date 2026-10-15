import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, inArray, sql } from 'drizzle-orm';
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
import {
    UpdatePetVeterinaryVisit,
    PetVeterinaryVisitNotFoundError,
} from '../../src/health/application/update-pet-veterinary-visit/update-pet-veterinary-visit';
import {
    InvalidVeterinaryVisitReasonError,
    InvalidVeterinaryVisitDateError,
    InvalidVeterinaryVisitObservationsError,
    InvalidVeterinaryVisitDiagnosisError,
} from '../../src/health/application/record-pet-veterinary-visit/record-pet-veterinary-visit';
import { HEALTH_CLOCK } from '../../src/health/application/time/clock';
import type { PetVeterinaryVisitCorrection } from '../../src/health/application/persistence/pet-veterinary-visit.repository';
import { ListPetVeterinaryVisits } from '../../src/health/application/list-pet-veterinary-visits/list-pet-veterinary-visits';

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

describe('UpdatePetVeterinaryVisit with PostgreSQL (integration)', () => {
    let currentTime: Date;
    let clockCalls: number = 0;
    const now = (): Date => {
        clockCalls += 1;

        return currentTime;
    };
    let application: INestApplicationContext;
    let database: DatabaseService;
    let recordPetVeterinaryVisit: RecordPetVeterinaryVisit;
    let updatePetVeterinaryVisit: UpdatePetVeterinaryVisit;
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
        recordPetVeterinaryVisit = application.get(RecordPetVeterinaryVisit);
        updatePetVeterinaryVisit = application.get(UpdatePetVeterinaryVisit);
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
                name: 'Veterinary visit pet',
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
            .delete(healthPetVeterinaryVisits)
            .where(inArray(healthPetVeterinaryVisits.petId, [petId, otherPetId]));
        await database.connection.delete(petMemberships).where(eq(petMemberships.petId, petId));
        await database.connection.delete(pets).where(inArray(pets.id, [petId, otherPetId]));

        for (const id of [ownerId, collaboratorId, outsiderId]) {
            await database.connection.delete(accounts).where(eq(accounts.id, id));
        }
    });

    function create(
        accountId: string = ownerId,
        observations: string | null = '  Monitored periodically.  ',
    ) {
        return recordPetVeterinaryVisit.execute({
            petId,
            reason: '  Arthritis  ',
            visitDate: '2026-02-10',
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
        visitId: string,
        patch: Partial<PetVeterinaryVisitCorrection> = { reason: 'Osteoarthritis' },
        authenticatedAccountId: string = ownerId,
    ) {
        return updatePetVeterinaryVisit.execute({
            petId,
            visitId,
            authenticatedAccountId,
            ...patch,
        });
    }

    async function physicalRow(visitId: string) {
        const results = await database.connection.execute(
            sql`SELECT id, pet_id, recorded_by_account_id, reason, visit_date, diagnosis, observations, created_at::text AS created_at, updated_at::text AS updated_at, xmin::text AS version, ctid::text AS location FROM health_pet_veterinary_visits WHERE id = ${visitId}`,
        );

        return results[0];
    }

    it.each(['OWNER', 'COLLABORATOR'] as const)(
        'allows active %s to correct another author and preserves identity',
        async (role) => {
            const created = await create(role === 'OWNER' ? collaboratorId : ownerId);
            const before = await physicalRow(created.id);
            const petBefore = await database.connection
                .select()
                .from(pets)
                .where(eq(pets.id, petId));
            const membershipsBefore = await database.connection
                .select()
                .from(petMemberships)
                .where(eq(petMemberships.petId, petId));

            clockCalls = 0;
            const corrected = await update(
                created.id,
                {
                    reason: ' Osteoarthritis ',
                    visitDate: '2026-02-10',
                    observations: ' Corrected ',
                },
                role === 'OWNER' ? ownerId : collaboratorId,
            );

            expect(corrected).toEqual({
                ...created,
                reason: 'Osteoarthritis',
                visitDate: '2026-02-10',
                observations: 'Corrected',
            });
            expect(clockCalls).toBe(1);
            const after = await physicalRow(created.id);

            expect(after).toMatchObject({
                id: before.id,
                pet_id: before.pet_id,
                recorded_by_account_id: before.recorded_by_account_id,
                created_at: before.created_at,
            });
            expect(after.version).not.toBe(before.version);
            expect(await database.connection.select().from(pets).where(eq(pets.id, petId))).toEqual(
                petBefore,
            );
            expect(
                await database.connection
                    .select()
                    .from(petMemberships)
                    .where(eq(petMemberships.petId, petId)),
            ).toEqual(membershipsBefore);
        },
    );

    it('skips physical no-ops, advances timestamps on changes, clears optional fields and preserves duplicates', async () => {
        const created = await create();

        await database.connection
            .update(healthPetVeterinaryVisits)
            .set({
                diagnosis: 'Original diagnosis',
                createdAt: new Date('2000-01-01T00:00:00Z'),
                updatedAt: new Date('2000-01-01T00:00:00Z'),
            })
            .where(eq(healthPetVeterinaryVisits.id, created.id));
        const before = await physicalRow(created.id);

        for (const patch of [
            { reason: ' Arthritis ' },
            { visitDate: '2026-02-10' },
            { diagnosis: ' Original diagnosis ' },
            { observations: ' Monitored periodically. ' },
        ]) {
            await update(created.id, patch);
            expect(await physicalRow(created.id)).toEqual(before);
        }

        await update(created.id, { diagnosis: null, observations: null });
        const changed = await physicalRow(created.id);

        expect(changed.created_at).toBe(before.created_at);
        expect(changed.updated_at).not.toBe(before.updated_at);
        expect(changed.version).not.toBe(before.version);
        await update(created.id, { diagnosis: null, observations: null });
        expect(await physicalRow(created.id)).toEqual(changed);
        await create();
        expect(await rows()).toHaveLength(2);
    });

    it('preserves a persisted date beyond today when omitted but rejects an explicit future date', async () => {
        const visitId: string = randomUUID();

        await database.connection.insert(healthPetVeterinaryVisits).values({
            id: visitId,
            petId,
            reason: 'Arthritis',
            visitDate: '2027-01-01',
            recordedByAccountId: ownerId,
        });
        expect(
            await update(visitId, { observations: 'Corrected historical information' }),
        ).toMatchObject({ visitDate: '2027-01-01' });
        const before = await physicalRow(visitId);

        await update(visitId, { reason: ' Arthritis ' });
        expect(await physicalRow(visitId)).toEqual(before);
        await expect(update(visitId, { visitDate: '2027-01-01' })).rejects.toThrow(
            InvalidVeterinaryVisitDateError,
        );
        expect(await physicalRow(visitId)).toEqual(before);
    });

    it('allows another member to correct after the author leaves', async () => {
        const created = await create(collaboratorId);

        await changeAccess('leave');
        expect(await update(created.id)).toMatchObject({
            recordedByAccountId: collaboratorId,
        });
        await expect(update(created.id, { reason: '' }, collaboratorId)).rejects.toThrow(
            PetNotFoundError,
        );
    });

    it('authorizes access before target resolution and semantic validation without consulting Clock on missing access/target', async () => {
        const created = await create();
        const otherVisitId: string = randomUUID();

        await database.connection.insert(healthPetVeterinaryVisits).values({
            id: otherVisitId,
            petId: otherPetId,
            reason: 'Other',
            visitDate: '2026-02-10',
            recordedByAccountId: ownerId,
        });
        clockCalls = 0;
        await expect(update(created.id, { reason: '' }, outsiderId)).rejects.toThrow(
            PetNotFoundError,
        );
        await expect(update(created.id, { petId: randomUUID(), reason: '' })).rejects.toThrow(
            PetNotFoundError,
        );
        await expect(update(randomUUID(), { reason: '' })).rejects.toThrow(
            PetVeterinaryVisitNotFoundError,
        );
        await expect(update(otherVisitId, { reason: '' })).rejects.toThrow(
            PetVeterinaryVisitNotFoundError,
        );
        await changeAccess('leave');
        await expect(update(created.id, { reason: '' }, collaboratorId)).rejects.toThrow(
            PetNotFoundError,
        );
        await changeAccess('archive');
        await expect(update(created.id, { reason: '' })).rejects.toThrow(PetNotFoundError);
        expect(clockCalls).toBe(0);
    });

    it.each([
        [{ reason: '' }, InvalidVeterinaryVisitReasonError],
        [{ observations: ' ' }, InvalidVeterinaryVisitObservationsError],
        [{ diagnosis: ' ' }, InvalidVeterinaryVisitDiagnosisError],
        [{ visitDate: '2026-02-29' }, InvalidVeterinaryVisitDateError],
        [{ visitDate: '2026-03-15' }, InvalidVeterinaryVisitDateError],
        [{ reason: 'Changed', observations: ' ' }, InvalidVeterinaryVisitObservationsError],
    ])('rolls back semantic error %j and releases locks', async (patch, errorClass) => {
        const created = await create();
        const before = await physicalRow(created.id);

        await expect(update(created.id, patch)).rejects.toThrow(errorClass);
        expect(await physicalRow(created.id)).toEqual(before);
        await expect(update(created.id)).resolves.toMatchObject({
            reason: 'Osteoarthritis',
        });
    });

    it('List reflects corrected values and visit date ordering', async () => {
        const first = await create();
        const second = await create();

        await update(first.id, { visitDate: '2026-02-10' });
        await update(second.id, { visitDate: '2026-03-14', observations: null });
        const list = (): Promise<unknown> =>
            application
                .get(ListPetVeterinaryVisits)
                .execute({ petId, authenticatedAccountId: ownerId });

        expect(await list()).toMatchObject({
            items: [
                { id: second.id, visitDate: '2026-03-14', observations: null },
                { id: first.id, visitDate: '2026-02-10' },
            ],
        });
        await update(second.id, { visitDate: '2026-01-01' });
        expect(await list()).toMatchObject({
            items: [{ id: first.id }, { id: second.id, visitDate: '2026-01-01' }],
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
        const correction = settle(update(created.id, { visitDate: '2026-03-15' }));

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
            value: { visitDate: '2026-03-15' },
        });
        expect(clockCalls).toBe(1);
    });
    it.each([false, true])(
        'preserves both concurrent patches without lost updates, reverse=%s',
        async (isReverse: boolean) => {
            const created = await create(ownerId, null);
            const nameCorrection = (): Promise<unknown> =>
                update(created.id, { reason: 'Osteoarthritis' });
            const notesCorrection = (): Promise<unknown> =>
                update(created.id, { observations: 'Monitored periodically' }, collaboratorId);
            const [first, second] = await race(
                isReverse ? notesCorrection : nameCorrection,
                isReverse ? nameCorrection : notesCorrection,
            );

            expect(first.error).toBeUndefined();
            expect(second.error).toBeUndefined();
            expect(second.value).toMatchObject({
                reason: 'Osteoarthritis',
                observations: 'Monitored periodically',
            });
            expect(await physicalRow(created.id)).toMatchObject({
                reason: 'Osteoarthritis',
                observations: 'Monitored periodically',
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
                () => update(created.id, { reason: 'Osteoarthritis' }, collaboratorId),
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
                () => update(created.id, { reason: 'Osteoarthritis' }, collaboratorId),
                () => changeAccess(action),
            );

            expect(correction.error).toBeUndefined();
            expect(correction.value).toMatchObject({
                reason: 'Osteoarthritis',
                recordedByAccountId: ownerId,
            });
            expect(change.error).toBeUndefined();
            expect(await physicalRow(created.id)).toMatchObject({
                reason: 'Osteoarthritis',
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
                expect(second.value).toMatchObject({ reason: 'Osteoarthritis' });
            }
        },
    );
});
