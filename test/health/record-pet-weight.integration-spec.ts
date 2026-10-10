import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { DeletePetWeightRecord } from '../../src/health/application/delete-pet-weight-record/delete-pet-weight-record';
import {
    UpdatePetWeightRecord,
    WeightRecordNotFoundError,
} from '../../src/health/application/update-pet-weight-record/update-pet-weight-record';
import {
    PetNotFoundError,
    RecordPetWeight,
} from '../../src/health/application/record-pet-weight/record-pet-weight';
import { HEALTH_CLOCK } from '../../src/health/application/time/clock';
import { MeasuredDate } from '../../src/health/domain/measured-date/measured-date';
import {
    PetId,
    RecordedByAccountId,
    WeightRecord,
} from '../../src/health/domain/weight-record/weight-record';
import { Weight } from '../../src/health/domain/weight/weight';
import { DrizzleWeightRecordRepository } from '../../src/health/infrastructure/persistence/drizzle/drizzle-weight-record.repository';
import { healthWeightRecords } from '../../src/health/infrastructure/persistence/drizzle/health.schema';
import { accounts } from '../../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../../src/infrastructure/database/database.service';
import {
    petMemberships,
    pets,
} from '../../src/pet-management/infrastructure/persistence/drizzle/pet-management.schema';

describe('RecordPetWeight with PostgreSQL (integration)', () => {
    let application: INestApplicationContext;
    let database: DatabaseService;
    let recordPetWeight: RecordPetWeight;
    let updatePetWeightRecord: UpdatePetWeightRecord;
    let deletePetWeightRecord: DeletePetWeightRecord;
    let repository: DrizzleWeightRecordRepository;
    let petId: string;
    let ownerId: string;
    let collaboratorId: string;
    let collaboratorMembershipId: string;

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        })
            .overrideProvider(HEALTH_CLOCK)
            .useValue({ now: (): Date => new Date('2026-09-26T12:00:00.000Z') })
            .compile();

        application = moduleFixture;
        database = application.get(DatabaseService);
        recordPetWeight = application.get(RecordPetWeight);
        updatePetWeightRecord = application.get(UpdatePetWeightRecord);
        deletePetWeightRecord = application.get(DeletePetWeightRecord);
        repository = application.get(DrizzleWeightRecordRepository);
    });

    afterAll(async () => {
        await application.close();
    });

    beforeEach(async () => {
        petId = randomUUID();
        ownerId = randomUUID();
        collaboratorId = randomUUID();
        collaboratorMembershipId = randomUUID();
        await database.connection.insert(accounts).values([
            {
                id: ownerId,
                email: `${ownerId}@example.com`,
                passwordHash: 'test-hash',
            },
            {
                id: collaboratorId,
                email: `${collaboratorId}@example.com`,
                passwordHash: 'test-hash',
            },
        ]);
        await database.connection.insert(pets).values({
            id: petId,
            name: 'Health pet',
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
            .delete(healthWeightRecords)
            .where(eq(healthWeightRecords.petId, petId));
        await database.connection.delete(petMemberships).where(eq(petMemberships.petId, petId));
        await database.connection.delete(pets).where(eq(pets.id, petId));
        await database.connection.delete(accounts).where(eq(accounts.id, ownerId));
        await database.connection.delete(accounts).where(eq(accounts.id, collaboratorId));
    });

    function record(accountId: string = ownerId, weightKg = '12.3456') {
        return recordPetWeight.execute({
            petId,
            authenticatedAccountId: accountId,
            weightKg,
            measuredDate: '2024-02-29',
        });
    }

    function correct(weightRecordId: string, accountId: string = collaboratorId, weightKg = '13') {
        return updatePetWeightRecord.execute({
            petId,
            weightRecordId,
            authenticatedAccountId: accountId,
            weightKg,
        });
    }

    function remove(weightRecordId: string, accountId: string = collaboratorId) {
        return deletePetWeightRecord.execute({
            petId,
            weightRecordId,
            authenticatedAccountId: accountId,
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

    it('persists exact decimal, civil date and recorder for owner and collaborator; allows same-day records', async () => {
        const ownerRecord = await record(ownerId, '00012.3400');
        const collaboratorRecord = await record(collaboratorId, '12.3456');

        expect(ownerRecord).toMatchObject({
            petId,
            weightKg: '12.34',
            measuredDate: '2024-02-29',
            recordedByAccountId: ownerId,
        });
        expect(collaboratorRecord).toMatchObject({
            petId,
            weightKg: '12.3456',
            measuredDate: '2024-02-29',
            recordedByAccountId: collaboratorId,
        });
        const rows = await database.connection
            .select()
            .from(healthWeightRecords)
            .where(eq(healthWeightRecords.petId, petId));

        expect(rows).toHaveLength(2);
        expect(rows.map((row) => row.weightKg).sort()).toEqual(['12.34', '12.3456']);
        expect(rows.map((row) => row.measuredDate)).toEqual(['2024-02-29', '2024-02-29']);
    });

    it('hides archived pet, inactive membership, missing membership and missing pet', async () => {
        await database.connection
            .update(petMemberships)
            .set({ status: 'INACTIVE' })
            .where(
                and(eq(petMemberships.petId, petId), eq(petMemberships.accountId, collaboratorId)),
            );
        await expect(record(collaboratorId)).rejects.toThrow(PetNotFoundError);
        await database.connection
            .delete(petMemberships)
            .where(
                and(eq(petMemberships.petId, petId), eq(petMemberships.accountId, collaboratorId)),
            );
        await expect(record(collaboratorId)).rejects.toThrow(PetNotFoundError);
        await database.connection
            .update(pets)
            .set({ status: 'ARCHIVED' })
            .where(eq(pets.id, petId));
        await expect(record(ownerId)).rejects.toThrow(PetNotFoundError);
        await expect(
            recordPetWeight.execute({
                petId: randomUUID(),
                authenticatedAccountId: ownerId,
                weightKg: '1',
                measuredDate: '2024-02-29',
            }),
        ).rejects.toThrow(PetNotFoundError);
        expect(
            await database.connection
                .select()
                .from(healthWeightRecords)
                .where(eq(healthWeightRecords.petId, petId)),
        ).toHaveLength(0);
    });

    it('rolls back a failed insert and enforces foreign keys and decimal constraints', async () => {
        const created = await record();

        await expect(
            database.connection.delete(accounts).where(eq(accounts.id, ownerId)),
        ).rejects.toThrow();
        await expect(database.connection.delete(pets).where(eq(pets.id, petId))).rejects.toThrow();
        await expect(
            database.connection.insert(healthWeightRecords).values({
                id: randomUUID(),
                petId,
                recordedByAccountId: ownerId,
                weightKg: '1.00001',
                measuredDate: '2024-02-29',
            }),
        ).rejects.toThrow();
        const duplicate = WeightRecord.create({
            petId: PetId.from(petId),
            recordedByAccountId: RecordedByAccountId.from(ownerId),
            weight: Weight.fromKilograms('1'),
            measuredDate: MeasuredDate.from('2024-02-29', '2026-09-26'),
        });

        await expect(repository.createIfPetWritable(duplicate)).resolves.toBe('CREATED');
        await expect(repository.createIfPetWritable(duplicate)).rejects.toThrow();
        const rows = await database.connection
            .select()
            .from(healthWeightRecords)
            .where(eq(healthWeightRecords.petId, petId));

        expect(rows.map((row) => row.id).sort()).toEqual([created.id, duplicate.id.value].sort());
    });

    it('observes archiving that wins the Pet lock', async () => {
        let release: (() => void) | undefined;
        let signalLocked: (() => void) | undefined;
        const locked = new Promise<void>((resolve) => {
            signalLocked = resolve;
        });
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const archive = database.connection.transaction(async (transaction) => {
            await transaction.update(pets).set({ status: 'ARCHIVED' }).where(eq(pets.id, petId));
            signalLocked?.();
            await gate;
        });

        await locked;
        const pending = expect(record()).rejects.toThrow(PetNotFoundError);

        try {
            await waitForLock('pets');
        } finally {
            release?.();
        }

        await archive;
        await pending;
    });

    it('observes membership deactivation that wins its lock', async () => {
        let release: (() => void) | undefined;
        let signalLocked: (() => void) | undefined;
        const locked = new Promise<void>((resolve) => {
            signalLocked = resolve;
        });
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const deactivate = database.connection.transaction(async (transaction) => {
            await transaction
                .update(petMemberships)
                .set({ status: 'INACTIVE' })
                .where(
                    and(
                        eq(petMemberships.petId, petId),
                        eq(petMemberships.accountId, collaboratorId),
                    ),
                );
            signalLocked?.();
            await gate;
        });

        await locked;
        const pending = expect(record(collaboratorId)).rejects.toThrow(PetNotFoundError);

        try {
            await waitForLock('pet_memberships');
        } finally {
            release?.();
        }

        await deactivate;
        await pending;
    });

    it('corrects without changing author or timestamps on a no-op, then physically deletes', async () => {
        const created = await record();
        const before = (
            await database.connection
                .select()
                .from(healthWeightRecords)
                .where(eq(healthWeightRecords.id, created.id))
        )[0];
        const unchanged = await correct(created.id, collaboratorId, '012.3456');

        expect(unchanged).toMatchObject({
            weightKg: '12.3456',
            recordedByAccountId: ownerId,
        });
        const afterNoop = (
            await database.connection
                .select()
                .from(healthWeightRecords)
                .where(eq(healthWeightRecords.id, created.id))
        )[0];

        expect(afterNoop?.updatedAt).toEqual(before?.updatedAt);
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        const changed = await correct(created.id, collaboratorId, '13.5000');

        expect(changed).toMatchObject({
            weightKg: '13.5',
            recordedByAccountId: ownerId,
        });
        const afterChange = (
            await database.connection
                .select()
                .from(healthWeightRecords)
                .where(eq(healthWeightRecords.id, created.id))
        )[0];

        expect(afterChange?.createdAt).toEqual(before?.createdAt);
        expect(afterChange?.updatedAt.getTime()).toBeGreaterThan(before?.updatedAt.getTime() ?? 0);
        expect(afterChange?.recordedByAccountId).toBe(ownerId);
        await remove(created.id);
        expect(
            await database.connection
                .select()
                .from(healthWeightRecords)
                .where(eq(healthWeightRecords.id, created.id)),
        ).toHaveLength(0);
        await expect(remove(created.id)).rejects.toThrow(WeightRecordNotFoundError);
    });

    it('serializes competing corrections and deletion after a record lock', async () => {
        const created = await record();
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
                .from(healthWeightRecords)
                .where(eq(healthWeightRecords.id, created.id))
                .for('update');
            signalLocked?.();
            await gate;
        });

        await locked;
        const pending = correct(created.id, ownerId, '14');

        try {
            await waitForLock('health_weight_records');
        } finally {
            release?.();
        }

        await holder;
        expect((await pending).weightKg).toBe('14');
        await Promise.all([
            correct(created.id, ownerId, '15'),
            correct(created.id, collaboratorId, '16'),
        ]);
        const rows = await database.connection
            .select()
            .from(healthWeightRecords)
            .where(eq(healthWeightRecords.id, created.id));

        expect(['15', '16']).toContain(rows[0]?.weightKg);
        await Promise.allSettled([remove(created.id), remove(created.id)]).then((results) => {
            expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
            expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
        });
    });

    it('makes a queued correction observe deletion and never restores the record', async () => {
        const created = await record();
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
                .from(healthWeightRecords)
                .where(eq(healthWeightRecords.id, created.id))
                .for('update');
            signalLocked?.();
            await gate;
        });

        await locked;
        const deleting = remove(created.id);

        await waitForLock('health_weight_records');
        const pending = expect(correct(created.id)).rejects.toThrow(WeightRecordNotFoundError);

        try {
            await waitForLock('pets');
        } finally {
            release?.();
        }

        await holder;
        await deleting;
        await pending;
        expect(
            await database.connection
                .select()
                .from(healthWeightRecords)
                .where(eq(healthWeightRecords.id, created.id)),
        ).toHaveLength(0);
    });

    it('hides a record when archive or leave wins its access lock', async () => {
        const created = await record();

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
                action === 'archive' ? correct(created.id) : remove(created.id),
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
            }
        }
    });

    it('lets a correction finish before later archive or leave changes access', async () => {
        const created = await record();

        for (const action of ['archive', 'leave'] as const) {
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
                    .from(healthWeightRecords)
                    .where(eq(healthWeightRecords.id, created.id))
                    .for('update');
                signalLocked?.();
                await gate;
            });

            await locked;
            const pending = correct(created.id, collaboratorId, action === 'archive' ? '14' : '15');

            await waitForLock('health_weight_records');
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
            expect((await pending).weightKg).toBe(action === 'archive' ? '14' : '15');
            await change;

            if (action === 'archive') {
                await database.connection
                    .update(pets)
                    .set({ status: 'ACTIVE' })
                    .where(eq(pets.id, petId));
            }
        }
    });
});
