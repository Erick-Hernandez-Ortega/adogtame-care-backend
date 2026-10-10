import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { DeleteVaccinationRecord } from '../../src/health/application/delete-vaccination-record/delete-vaccination-record';
import {
    InvalidNextDueDateError,
    PetNotFoundError,
    RecordVaccination,
} from '../../src/health/application/record-vaccination/record-vaccination';
import { HEALTH_CLOCK } from '../../src/health/application/time/clock';
import {
    UpdateVaccinationRecord,
    VaccinationRecordNotFoundError,
} from '../../src/health/application/update-vaccination-record/update-vaccination-record';
import { ListPetVaccinationHistory } from '../../src/health/application/list-pet-vaccination-history/list-pet-vaccination-history';
import { healthVaccinationRecords } from '../../src/health/infrastructure/persistence/drizzle/health.schema';
import { accounts } from '../../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../../src/infrastructure/database/database.service';
import {
    petMemberships,
    pets,
} from '../../src/pet-management/infrastructure/persistence/drizzle/pet-management.schema';

describe('ManageVaccinationRecord with PostgreSQL (integration)', () => {
    let application: INestApplicationContext;
    let database: DatabaseService;
    let createUseCase: RecordVaccination;
    let updateUseCase: UpdateVaccinationRecord;
    let deleteUseCase: DeleteVaccinationRecord;
    let historyUseCase: ListPetVaccinationHistory;
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
            .useValue({ now: (): Date => new Date('2026-09-27T12:00:00.000Z') })
            .compile();

        application = fixture;
        database = application.get(DatabaseService);
        createUseCase = application.get(RecordVaccination);
        updateUseCase = application.get(UpdateVaccinationRecord);
        deleteUseCase = application.get(DeleteVaccinationRecord);
        historyUseCase = application.get(ListPetVaccinationHistory);
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
            [ownerId, collaboratorId, outsiderId].map((id) => ({
                id,
                email: `${id}@example.com`,
                passwordHash: 'test-hash',
            })),
        );
        await database.connection.insert(pets).values({
            id: petId,
            name: 'Vaccination pet',
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
            .delete(healthVaccinationRecords)
            .where(eq(healthVaccinationRecords.petId, petId));
        await database.connection.delete(petMemberships).where(eq(petMemberships.petId, petId));
        await database.connection.delete(pets).where(eq(pets.id, petId));

        for (const accountId of [ownerId, collaboratorId, outsiderId]) {
            await database.connection.delete(accounts).where(eq(accounts.id, accountId));
        }
    });

    function create(accountId: string = ownerId) {
        return createUseCase.execute({
            petId,
            authenticatedAccountId: accountId,
            vaccineName: 'Rabies',
            appliedDate: '2026-01-01',
            nextDueDate: '2027-01-01',
        });
    }

    function update(
        vaccinationRecordId: string,
        changes: {
            vaccineName?: string;
            appliedDate?: string;
            nextDueDate?: string | null;
        },
        authenticatedAccountId: string = collaboratorId,
        targetPetId: string = petId,
    ) {
        return updateUseCase.execute({
            petId: targetPetId,
            vaccinationRecordId,
            authenticatedAccountId,
            ...changes,
        });
    }

    function remove(
        vaccinationRecordId: string,
        authenticatedAccountId: string = collaboratorId,
        targetPetId: string = petId,
    ) {
        return deleteUseCase.execute({
            petId: targetPetId,
            vaccinationRecordId,
            authenticatedAccountId,
        });
    }

    async function waitForLock(table: string): Promise<void> {
        for (let attempt = 0; attempt < 200; attempt += 1) {
            const rows = await database.connection.execute(
                sql`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE ${`%${table}%`}`,
            );

            if (Number(rows[0]?.waiting ?? 0) > 0) {
                return;
            }

            await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }

        throw new Error(`No waiter on ${table}`);
    }

    it('updates all fields and authorizes owner or collaborator regardless of recorder', async () => {
        const created = await create(ownerId);

        expect(await update(created.id, { vaccineName: '  Rabies Booster  ' })).toMatchObject({
            vaccineName: 'Rabies Booster',
            recordedByAccountId: ownerId,
        });
        expect(await update(created.id, { appliedDate: '2026-02-01' }, ownerId)).toMatchObject({
            appliedDate: '2026-02-01',
        });
        expect(await update(created.id, { nextDueDate: '2028-01-01' })).toMatchObject({
            nextDueDate: '2028-01-01',
        });
        expect(await update(created.id, { nextDueDate: null }, ownerId)).toMatchObject({
            nextDueDate: null,
        });
        expect(
            await update(created.id, {
                vaccineName: 'Distemper',
                appliedDate: '2026-03-01',
                nextDueDate: '2027-03-01',
            }),
        ).toEqual({
            id: created.id,
            petId,
            vaccineName: 'Distemper',
            appliedDate: '2026-03-01',
            nextDueDate: '2027-03-01',
            recordedByAccountId: ownerId,
        });
        const row = (
            await database.connection
                .select()
                .from(healthVaccinationRecords)
                .where(eq(healthVaccinationRecords.id, created.id))
        )[0];

        expect(row?.recordedByAccountId).toBe(ownerId);
        expect(row?.nextDueDate).toBe('2027-03-01');
    });

    it('skips physical update for normalized name and null no-ops', async () => {
        const created = await create();
        const before = (
            await database.connection
                .select()
                .from(healthVaccinationRecords)
                .where(eq(healthVaccinationRecords.id, created.id))
        )[0];

        await update(created.id, { vaccineName: '  Rabies  ' });
        const afterNoop = (
            await database.connection
                .select()
                .from(healthVaccinationRecords)
                .where(eq(healthVaccinationRecords.id, created.id))
        )[0];

        expect(afterNoop?.updatedAt).toEqual(before?.updatedAt);
        await update(created.id, { nextDueDate: null });
        const afterClear = (
            await database.connection
                .select()
                .from(healthVaccinationRecords)
                .where(eq(healthVaccinationRecords.id, created.id))
        )[0];

        await update(created.id, { nextDueDate: null });
        const afterNullNoop = (
            await database.connection
                .select()
                .from(healthVaccinationRecords)
                .where(eq(healthVaccinationRecords.id, created.id))
        )[0];

        expect(afterNullNoop?.updatedAt).toEqual(afterClear?.updatedAt);
        expect(afterClear?.updatedAt.getTime()).toBeGreaterThan(before?.updatedAt.getTime() ?? 0);
        expect(afterNullNoop?.createdAt).toEqual(before?.createdAt);
    });

    it('rejects invalid resulting dates without changing the row', async () => {
        const created = await create();

        await expect(update(created.id, { nextDueDate: '2025-12-31' })).rejects.toThrow(
            InvalidNextDueDateError,
        );
        await expect(
            update(created.id, {
                appliedDate: '2026-06-01',
                nextDueDate: '2026-03-01',
            }),
        ).rejects.toThrow(InvalidNextDueDateError);
        await update(created.id, { nextDueDate: '2026-03-01' });
        await expect(update(created.id, { appliedDate: '2026-06-01' })).rejects.toThrow(
            InvalidNextDueDateError,
        );
        const row = (
            await database.connection
                .select()
                .from(healthVaccinationRecords)
                .where(eq(healthVaccinationRecords.id, created.id))
        )[0];

        expect(row?.appliedDate).toBe('2026-01-01');
        expect(row?.nextDueDate).toBe('2026-03-01');
    });

    it('hides inaccessible pets and records under another pet', async () => {
        const created = await create();

        await expect(update(created.id, { vaccineName: 'New' }, outsiderId)).rejects.toThrow(
            PetNotFoundError,
        );
        await expect(remove(created.id, outsiderId)).rejects.toThrow(PetNotFoundError);
        await expect(
            update(created.id, { vaccineName: 'New' }, ownerId, randomUUID()),
        ).rejects.toThrow(PetNotFoundError);
        await expect(remove(created.id, ownerId, randomUUID())).rejects.toThrow(PetNotFoundError);
        await expect(update(randomUUID(), { vaccineName: 'New' }, ownerId)).rejects.toThrow(
            VaccinationRecordNotFoundError,
        );
        await expect(remove(randomUUID(), ownerId)).rejects.toThrow(VaccinationRecordNotFoundError);
        const otherPetId: string = randomUUID();

        await database.connection.insert(pets).values({
            id: otherPetId,
            name: 'Other pet',
            species: 'CAT',
            breedName: 'Mixed',
            breedKind: 'CUSTOM',
            sex: 'UNKNOWN',
            birthDate: '2020-01-01',
            birthDateAccuracy: 'EXACT',
            status: 'ACTIVE',
        });
        await database.connection.insert(healthVaccinationRecords).values({
            id: randomUUID(),
            petId: otherPetId,
            vaccineName: 'Other',
            appliedDate: '2026-01-01',
            nextDueDate: null,
            recordedByAccountId: ownerId,
        });
        const otherRecord = (
            await database.connection
                .select({ id: healthVaccinationRecords.id })
                .from(healthVaccinationRecords)
                .where(eq(healthVaccinationRecords.petId, otherPetId))
        )[0];

        await expect(update(otherRecord.id, { vaccineName: 'New' }, ownerId)).rejects.toThrow(
            VaccinationRecordNotFoundError,
        );
        await expect(remove(otherRecord.id, ownerId)).rejects.toThrow(
            VaccinationRecordNotFoundError,
        );
        await database.connection
            .delete(healthVaccinationRecords)
            .where(eq(healthVaccinationRecords.petId, otherPetId));
        await database.connection.delete(pets).where(eq(pets.id, otherPetId));

        await database.connection
            .update(petMemberships)
            .set({ status: 'INACTIVE' })
            .where(eq(petMemberships.id, collaboratorMembershipId));
        await expect(update(created.id, { vaccineName: 'New' })).rejects.toThrow(PetNotFoundError);
        await expect(remove(created.id)).rejects.toThrow(PetNotFoundError);
        await database.connection
            .update(pets)
            .set({ status: 'ARCHIVED' })
            .where(eq(pets.id, petId));
        await expect(update(created.id, { vaccineName: 'New' }, ownerId)).rejects.toThrow(
            PetNotFoundError,
        );
        await expect(remove(created.id, ownerId)).rejects.toThrow(PetNotFoundError);
    });

    it('hard deletes records and removes them from vaccination history', async () => {
        const created = await create(ownerId);

        await remove(created.id, collaboratorId);
        expect(
            await database.connection
                .select()
                .from(healthVaccinationRecords)
                .where(eq(healthVaccinationRecords.id, created.id)),
        ).toHaveLength(0);
        expect(
            await historyUseCase.execute({
                petId,
                authenticatedAccountId: ownerId,
                limit: 20,
                cursor: null,
            }),
        ).toMatchObject({ items: [] });
        await expect(remove(created.id, ownerId)).rejects.toThrow(VaccinationRecordNotFoundError);
        const collaboratorRecord = await create(collaboratorId);

        await remove(collaboratorRecord.id, ownerId);
    });

    it('serializes conflicting PATCH operations against the effective state', async () => {
        const created = await create();
        let release: (() => void) | undefined;
        let signalLocked: (() => void) | undefined;
        const locked = new Promise<void>((resolve) => {
            signalLocked = resolve;
        });
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const holder = database.connection.transaction(async (transaction) => {
            await transaction
                .select()
                .from(healthVaccinationRecords)
                .where(eq(healthVaccinationRecords.id, created.id))
                .for('update');
            signalLocked?.();
            await gate;
        });

        await locked;
        const first = update(created.id, { appliedDate: '2026-06-01' }, ownerId);

        await waitForLock('health_vaccination_records');
        const second = update(created.id, { nextDueDate: '2026-03-01' });

        try {
            await waitForLock('pets');
        } finally {
            release?.();
        }

        await holder;
        await expect(first).resolves.toMatchObject({ appliedDate: '2026-06-01' });
        await expect(second).rejects.toThrow(InvalidNextDueDateError);
        const row = (
            await database.connection
                .select()
                .from(healthVaccinationRecords)
                .where(eq(healthVaccinationRecords.id, created.id))
        )[0];

        expect(row?.appliedDate).toBe('2026-06-01');
        expect(row?.nextDueDate).toBe('2027-01-01');
    });

    it.each(['patch-first', 'delete-first'] as const)(
        'serializes PATCH and DELETE when %s',
        async (order) => {
            const created = await create();
            let release: (() => void) | undefined;
            let signalLocked: (() => void) | undefined;
            const locked = new Promise<void>((resolve) => {
                signalLocked = resolve;
            });
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            const holder = database.connection.transaction(async (transaction) => {
                await transaction
                    .select()
                    .from(healthVaccinationRecords)
                    .where(eq(healthVaccinationRecords.id, created.id))
                    .for('update');
                signalLocked?.();
                await gate;
            });

            await locked;
            const first =
                order === 'patch-first'
                    ? update(created.id, { vaccineName: 'Changed' }, ownerId)
                    : remove(created.id, ownerId);

            await waitForLock('health_vaccination_records');
            const second =
                order === 'patch-first'
                    ? remove(created.id, collaboratorId)
                    : update(created.id, { vaccineName: 'Changed' }, collaboratorId);

            try {
                await waitForLock('pets');
            } finally {
                release?.();
            }

            await holder;

            if (order === 'patch-first') {
                await expect(first).resolves.toMatchObject({ vaccineName: 'Changed' });
                await expect(second).resolves.toBeUndefined();
            } else {
                await expect(first).resolves.toBeUndefined();
                await expect(second).rejects.toThrow(VaccinationRecordNotFoundError);
            }

            expect(
                await database.connection
                    .select()
                    .from(healthVaccinationRecords)
                    .where(eq(healthVaccinationRecords.id, created.id)),
            ).toHaveLength(0);
        },
    );

    it('allows exactly one concurrent DELETE to report success', async () => {
        const created = await create();
        let release: (() => void) | undefined;
        let signalLocked: (() => void) | undefined;
        const locked = new Promise<void>((resolve) => {
            signalLocked = resolve;
        });
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const holder = database.connection.transaction(async (transaction) => {
            await transaction
                .select()
                .from(healthVaccinationRecords)
                .where(eq(healthVaccinationRecords.id, created.id))
                .for('update');
            signalLocked?.();
            await gate;
        });

        await locked;
        const first = remove(created.id, ownerId);

        await waitForLock('health_vaccination_records');
        const second = expect(remove(created.id, collaboratorId)).rejects.toThrow(
            VaccinationRecordNotFoundError,
        );

        try {
            await waitForLock('pets');
        } finally {
            release?.();
        }

        await holder;
        await expect(first).resolves.toBeUndefined();
        await second;
    });

    it.each(['patch', 'delete'] as const)(
        'rejects %s after archive or leave wins the access lock',
        async (operation) => {
            const created = await create();

            for (const action of ['archive', 'leave'] as const) {
                let release: (() => void) | undefined;
                let signalLocked: (() => void) | undefined;
                const locked = new Promise<void>((resolve) => {
                    signalLocked = resolve;
                });
                const gate = new Promise<void>((resolve) => {
                    release = resolve;
                });
                const change = database.connection.transaction(async (transaction) => {
                    if (action === 'archive') {
                        await transaction
                            .update(pets)
                            .set({ status: 'ARCHIVED' })
                            .where(eq(pets.id, petId));
                    } else {
                        await transaction
                            .update(petMemberships)
                            .set({ status: 'INACTIVE' })
                            .where(eq(petMemberships.id, collaboratorMembershipId));
                    }

                    signalLocked?.();
                    await gate;
                });

                await locked;
                const pending = expect(
                    operation === 'patch'
                        ? update(created.id, { vaccineName: 'Changed' })
                        : remove(created.id),
                ).rejects.toThrow(PetNotFoundError);

                try {
                    await waitForLock(action === 'archive' ? 'pets' : 'pet_memberships');
                } finally {
                    release?.();
                }

                await change;
                await pending;

                if (action === 'archive') {
                    await database.connection
                        .update(pets)
                        .set({ status: 'ACTIVE' })
                        .where(eq(pets.id, petId));
                } else {
                    await database.connection
                        .update(petMemberships)
                        .set({ status: 'ACTIVE' })
                        .where(eq(petMemberships.id, collaboratorMembershipId));
                }
            }
        },
    );

    it.each(['patch', 'delete'] as const)(
        'completes %s before a later archive or leave changes access',
        async (operation) => {
            for (const action of ['archive', 'leave'] as const) {
                const created = await create();
                let release: (() => void) | undefined;
                let signalLocked: (() => void) | undefined;
                const locked = new Promise<void>((resolve) => {
                    signalLocked = resolve;
                });
                const gate = new Promise<void>((resolve) => {
                    release = resolve;
                });
                const holder = database.connection.transaction(async (transaction) => {
                    await transaction
                        .select()
                        .from(healthVaccinationRecords)
                        .where(eq(healthVaccinationRecords.id, created.id))
                        .for('update');
                    signalLocked?.();
                    await gate;
                });

                await locked;
                const pending =
                    operation === 'patch'
                        ? update(created.id, { vaccineName: 'Changed' })
                        : remove(created.id);

                await waitForLock('health_vaccination_records');
                const change = database.connection.transaction(async (transaction) => {
                    if (action === 'archive') {
                        await transaction
                            .update(pets)
                            .set({ status: 'ARCHIVED' })
                            .where(eq(pets.id, petId));
                    } else {
                        await transaction
                            .update(petMemberships)
                            .set({ status: 'INACTIVE' })
                            .where(eq(petMemberships.id, collaboratorMembershipId));
                    }
                });

                try {
                    await waitForLock(action === 'archive' ? 'pets' : 'pet_memberships');
                } finally {
                    release?.();
                }

                await holder;

                if (operation === 'patch') {
                    await expect(pending).resolves.toMatchObject({
                        vaccineName: 'Changed',
                    });
                } else {
                    await expect(pending).resolves.toBeUndefined();
                }

                await change;

                if (action === 'archive') {
                    await database.connection
                        .update(pets)
                        .set({ status: 'ACTIVE' })
                        .where(eq(pets.id, petId));
                } else {
                    await database.connection
                        .update(petMemberships)
                        .set({ status: 'ACTIVE' })
                        .where(eq(petMemberships.id, collaboratorMembershipId));
                }
            }
        },
    );
});
