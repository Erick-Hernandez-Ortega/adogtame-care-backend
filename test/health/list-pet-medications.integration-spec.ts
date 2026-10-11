import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { DrizzlePetMedicationReader } from '../../src/health/infrastructure/persistence/drizzle/drizzle-pet-medication.reader';
import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import {
    ListPetMedications,
    PetNotFoundError,
    type PetMedications,
} from '../../src/health/application/list-pet-medications/list-pet-medications';
import type { ListedPetMedication } from '../../src/health/application/persistence/pet-medication.reader';
import { RecordPetMedication } from '../../src/health/application/record-pet-medication/record-pet-medication';
import { healthPetMedications } from '../../src/health/infrastructure/persistence/drizzle/health.schema';
import { accounts } from '../../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../../src/infrastructure/database/database.service';
import { ArchivePet } from '../../src/pet-management/application/archive-pet/archive-pet';
import { LeavePet } from '../../src/pet-management/application/leave-pet/leave-pet';
import { RemovePetMember } from '../../src/pet-management/application/remove-pet-member/remove-pet-member';
import { RestorePet } from '../../src/pet-management/application/restore-pet/restore-pet';
import {
    petMemberships,
    pets,
} from '../../src/pet-management/infrastructure/persistence/drizzle/pet-management.schema';

interface Barrier {
    readonly promise: Promise<void>;
    readonly release: () => void;
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
    readonly error?: unknown;
}

async function settle(action: Promise<unknown>): Promise<SettledAction> {
    try {
        await action;

        return {};
    } catch (error: unknown) {
        return { error };
    }
}

interface MedicationFixtureInput {
    readonly id?: string;
    readonly petId?: string;
    readonly name?: string;
    readonly dosage?: string | null;
    readonly frequency?: string | null;
    readonly startDate?: string | null;
    readonly plannedEndDate?: string | null;
    readonly notes?: string | null;
    readonly recordedByAccountId?: string;
    readonly createdAt?: string;
}

const HIGH_ID: string = '10000000-0000-4000-8000-000000000004';
const MIDDLE_ID: string = '10000000-0000-4000-8000-000000000003';
const LOW_ID: string = '10000000-0000-4000-8000-000000000002';
const LOWEST_ID: string = '10000000-0000-4000-8000-000000000001';

describe('ListPetMedications with PostgreSQL (integration)', () => {
    let application: INestApplicationContext;
    let database: DatabaseService;
    let listPetMedications: ListPetMedications;
    let petId: string;
    let otherPetId: string;
    let ownerId: string;
    let collaboratorId: string;
    let outsiderId: string;
    let collaboratorMembershipId: string;

    beforeAll(async (): Promise<void> => {
        const fixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        application = fixture;
        database = application.get(DatabaseService);
        listPetMedications = application.get(ListPetMedications);
    });

    afterAll(async (): Promise<void> => {
        await application.close();
    });

    beforeEach(async (): Promise<void> => {
        petId = randomUUID();
        otherPetId = randomUUID();
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
        await database.connection.insert(pets).values(
            [petId, otherPetId].map((fixturePetId: string) => ({
                id: fixturePetId,
                name: 'Medication pet',
                species: 'DOG' as const,
                breedName: 'Mixed',
                breedKind: 'CUSTOM' as const,
                sex: 'UNKNOWN' as const,
                birthDate: '2020-01-01',
                birthDateAccuracy: 'EXACT' as const,
                status: 'ACTIVE' as const,
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
            {
                id: randomUUID(),
                petId: otherPetId,
                accountId: ownerId,
                role: 'OWNER',
                status: 'ACTIVE',
            },
        ]);
    });

    afterEach(async (): Promise<void> => {
        await database.connection
            .delete(healthPetMedications)
            .where(inArray(healthPetMedications.petId, [petId, otherPetId]));
        await database.connection
            .delete(petMemberships)
            .where(inArray(petMemberships.petId, [petId, otherPetId]));
        await database.connection.delete(pets).where(inArray(pets.id, [petId, otherPetId]));
        await database.connection
            .delete(accounts)
            .where(inArray(accounts.id, [ownerId, collaboratorId, outsiderId]));
    });

    async function insertMedication(
        input: MedicationFixtureInput = {},
    ): Promise<ListedPetMedication> {
        const item: ListedPetMedication = {
            id: input.id ?? randomUUID(),
            name: input.name ?? 'Amoxicillin',
            dosage: input.dosage ?? null,
            frequency: input.frequency ?? null,
            startDate: input.startDate ?? null,
            plannedEndDate: input.plannedEndDate ?? null,
            notes: input.notes ?? null,
            status: 'OPEN',
            endedDate: null,
            discontinuationReason: null,
            recordedByAccountId: input.recordedByAccountId ?? ownerId,
        };
        const createdAt: string = input.createdAt ?? '2026-10-01T12:00:00.123456Z';

        await database.connection.insert(healthPetMedications).values({
            ...item,
            petId: input.petId ?? petId,
            createdAt: sql`${createdAt}::timestamptz`,
        });

        return item;
    }

    function list(
        accountId: string = ownerId,
        requestedPetId: string = petId,
    ): Promise<PetMedications> {
        return listPetMedications.execute({
            petId: requestedPetId,
            authenticatedAccountId: accountId,
        });
    }

    it.each([
        { status: 'ACTIVE', role: 'OWNER' },
        { status: 'ACTIVE', role: 'COLLABORATOR' },
        { status: 'ARCHIVED', role: 'OWNER' },
        { status: 'ARCHIVED', role: 'COLLABORATOR' },
    ] as const)(
        'returns items for an $status pet and active $role',
        async ({ status, role }): Promise<void> => {
            const item: ListedPetMedication = await insertMedication({
                notes: 'Reported reaction.',
            });

            await database.connection.update(pets).set({ status }).where(eq(pets.id, petId));
            const accountId: string = role === 'OWNER' ? ownerId : collaboratorId;

            await expect(list(accountId)).resolves.toEqual({ items: [item] });
        },
    );

    it.each(['ACTIVE', 'ARCHIVED'] as const)(
        'returns an empty collection for an accessible %s pet',
        async (status): Promise<void> => {
            await database.connection.update(pets).set({ status }).where(eq(pets.id, petId));

            for (const accountId of [ownerId, collaboratorId]) {
                await expect(list(accountId)).resolves.toEqual({ items: [] });
            }
        },
    );

    it.each(['ACTIVE', 'ARCHIVED'] as const)(
        'hides an %s pet from inactive authors and outsiders',
        async (status): Promise<void> => {
            await insertMedication();
            await insertMedication({ recordedByAccountId: collaboratorId });
            await database.connection.update(pets).set({ status }).where(eq(pets.id, petId));

            for (const accountId of [ownerId, collaboratorId]) {
                await database.connection
                    .update(petMemberships)
                    .set({ status: 'INACTIVE' })
                    .where(
                        and(
                            eq(petMemberships.petId, petId),
                            eq(petMemberships.accountId, accountId),
                        ),
                    );
                await expect(list(accountId)).rejects.toThrow(PetNotFoundError);
            }

            await expect(list(outsiderId)).rejects.toThrow(PetNotFoundError);
            await expect(list(ownerId, randomUUID())).rejects.toThrow(PetNotFoundError);
        },
    );

    it('orders technical timestamps at microsecond precision and tied UUIDs without crossing pets', async (): Promise<void> => {
        const oldest: ListedPetMedication = await insertMedication({
            id: HIGH_ID,
            name: 'Zinc',
            startDate: '2099-12-01',
            plannedEndDate: '2099-12-31',
            createdAt: '2026-09-30T12:00:00.123456Z',
        });
        const tiedLow: ListedPetMedication = await insertMedication({
            id: LOW_ID,
            name: 'Amoxicillin',
            dosage: '250 mg',
            frequency: 'Every 12 hours',
            startDate: '2020-01-01',
            plannedEndDate: null,
            notes: 'Give with food.',
        });
        const newest: ListedPetMedication = await insertMedication({
            id: LOWEST_ID,
            name: 'Meloxicam',
            startDate: null,
            plannedEndDate: '2099-01-01',
            recordedByAccountId: collaboratorId,
            createdAt: '2026-10-01T12:00:00.123457Z',
        });
        const tiedHigh: ListedPetMedication = await insertMedication({ id: MIDDLE_ID });

        await insertMedication({
            petId: otherPetId,
            createdAt: '2026-10-02T12:00:00Z',
        });
        await expect(list()).resolves.toEqual({
            items: [newest, tiedHigh, tiedLow, oldest],
        });
    });

    it('returns duplicates independently and never applies a hidden page limit', async (): Promise<void> => {
        const items: ListedPetMedication[] = [];

        for (let itemIndex: number = 0; itemIndex < 25; itemIndex += 1) {
            items.push(await insertMedication());
        }

        items.sort((firstItem: ListedPetMedication, secondItem: ListedPetMedication): number =>
            secondItem.id.localeCompare(firstItem.id),
        );
        await expect(list()).resolves.toEqual({ items });
    });

    it('preserves the read result through real Archive and Restore use cases', async (): Promise<void> => {
        await application.get(RecordPetMedication).execute({
            petId,
            authenticatedAccountId: ownerId,
            name: 'Amoxicillin',
        });
        const original: PetMedications = await list();

        await application.get(ArchivePet).execute({ petId, requesterAccountId: ownerId });
        await expect(list()).resolves.toEqual(original);
        await expect(list(collaboratorId)).resolves.toEqual(original);
        await application.get(RestorePet).execute({ petId, requesterAccountId: ownerId });
        await expect(list()).resolves.toEqual(original);
    });

    it.each(['leave', 'remove'] as const)(
        'revokes an author access after %s while preserving medications for the owner',
        async (action): Promise<void> => {
            await insertMedication({ recordedByAccountId: collaboratorId });
            const original: PetMedications = await list(collaboratorId);

            if (action === 'leave') {
                await application.get(LeavePet).execute(petId, collaboratorId);
            } else {
                await application.get(RemovePetMember).execute({
                    petId,
                    requesterAccountId: ownerId,
                    targetMembershipId: collaboratorMembershipId,
                });
            }

            await expect(list(collaboratorId)).rejects.toThrow(PetNotFoundError);
            await expect(list()).resolves.toEqual(original);
        },
    );

    it('has only the primary key and a simple non-unique pet index', async (): Promise<void> => {
        const rows = await database.connection.execute(
            sql`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'health_pet_medications' ORDER BY indexname`,
        );

        expect(rows.map((row): unknown => row.indexname)).toEqual([
            'health_pet_medications_pet_idx',
            'health_pet_medications_pkey',
        ]);
        expect(rows[0]?.indexdef).toContain('USING btree (pet_id)');
        expect(rows[0]?.indexdef).not.toContain('UNIQUE');
    });
    it('distinguishes inaccessible pets from accessible empty collections in the reader', async (): Promise<void> => {
        const reader: DrizzlePetMedicationReader = application.get(DrizzlePetMedicationReader);

        await expect(
            reader.listIfPetReadable({ petId, authenticatedAccountId: ownerId }),
        ).resolves.toEqual([]);
        await expect(
            reader.listIfPetReadable({ petId, authenticatedAccountId: outsiderId }),
        ).resolves.toBeNull();
        await expect(
            reader.listIfPetReadable({ petId: randomUUID(), authenticatedAccountId: ownerId }),
        ).resolves.toBeNull();
    });

    it('preserves every nullable field and independently known civil dates', async (): Promise<void> => {
        const unknown: ListedPetMedication = await insertMedication({ id: HIGH_ID });
        const startOnly: ListedPetMedication = await insertMedication({
            id: MIDDLE_ID,
            startDate: '0001-01-01',
        });
        const endOnly: ListedPetMedication = await insertMedication({
            id: LOW_ID,
            plannedEndDate: '9999-12-31',
        });
        const future: ListedPetMedication = await insertMedication({
            id: LOWEST_ID,
            dosage: 'Half tablet',
            frequency: 'As reported',
            startDate: '2099-01-01',
            plannedEndDate: '2099-12-31',
            notes: 'Future reported treatment.',
        });

        await expect(list()).resolves.toEqual({ items: [unknown, startOnly, endOnly, future] });
    });

    it('executes one authorized SELECT without locks or a transaction for each reader outcome', async (): Promise<void> => {
        const databaseUrl: string = application
            .get(ConfigService)
            .getOrThrow<string>('DATABASE_URL');
        const client = postgres(databaseUrl, { max: 1 });
        const queries: string[] = [];
        const connection = drizzle(client, {
            logger: {
                logQuery(query: string): void {
                    queries.push(query);
                },
            },
        });
        const originalConnection = database.connection;
        const originalTransaction = connection.transaction.bind(
            connection,
        ) as typeof connection.transaction;
        let transactionCount: number = 0;

        Object.defineProperty(database, 'connection', { value: connection });
        Object.defineProperty(connection, 'transaction', {
            configurable: true,
            value: (): never => {
                transactionCount += 1;
                throw new Error('Reader must not start a transaction');
            },
        });
        const reader: DrizzlePetMedicationReader = application.get(DrizzlePetMedicationReader);

        try {
            await expect(
                reader.listIfPetReadable({ petId, authenticatedAccountId: ownerId }),
            ).resolves.toEqual([]);
            expect(queries).toHaveLength(1);
            queries.length = 0;
            await expect(
                reader.listIfPetReadable({ petId, authenticatedAccountId: outsiderId }),
            ).resolves.toBeNull();
            expect(queries).toHaveLength(1);
            await insertMedication();
            queries.length = 0;
            const items: ListedPetMedication[] | null = await reader.listIfPetReadable({
                petId,
                authenticatedAccountId: ownerId,
            });

            expect(items).toHaveLength(1);
            expect(queries).toHaveLength(1);
            expect(transactionCount).toBe(0);
            const query: string = queries[0].toLowerCase();
            const projection: string = query.split(' from ')[0];

            expect(query).toMatch(/^select /);
            expect(query).toContain('inner join "pet_memberships"');
            expect(query).toContain('left join "health_pet_medications"');
            expect(query).toContain(
                'order by "health_pet_medications"."created_at" desc, "health_pet_medications"."id" desc',
            );
            expect(query).not.toMatch(/for (update|share)|limit|offset/);
            expect(projection).not.toMatch(/pet_id|created_at|updated_at/);
        } finally {
            Object.defineProperty(connection, 'transaction', { value: originalTransaction });
            Object.defineProperty(database, 'connection', { value: originalConnection });
            await client.end();
        }
    });

    async function whileCommitIsPending(
        action: () => Promise<unknown>,
        verify: () => Promise<void>,
    ): Promise<void> {
        const pendingCommit: Barrier = barrier();
        const released: Barrier = barrier();
        const connection = database.connection;
        const originalTransaction = connection.transaction.bind(
            connection,
        ) as typeof connection.transaction;

        type DatabaseTransaction = Parameters<Parameters<typeof originalTransaction>[0]>[0];
        type TransactionConfiguration = Parameters<typeof originalTransaction>[1];
        const gatedTransaction: typeof originalTransaction = <Result>(
            callback: (session: DatabaseTransaction) => Promise<Result>,
            configuration?: TransactionConfiguration,
        ): Promise<Result> =>
            originalTransaction(async (session): Promise<Result> => {
                await session.execute(sql`SET LOCAL statement_timeout = '5000ms'`);
                const result: Result = await callback(session);

                pendingCommit.release();
                await released.promise;

                return result;
            }, configuration);

        Object.defineProperty(connection, 'transaction', {
            value: gatedTransaction,
            configurable: true,
        });
        const writing: Promise<SettledAction> = settle(action());
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let reading: Promise<SettledAction> | undefined;

        try {
            await Promise.race([
                pendingCommit.promise,
                writing.then((result: SettledAction): never => {
                    throw new Error('Writer ended before reaching commit barrier', {
                        cause: result.error,
                    });
                }),
            ]);
            reading = settle(verify());
            const result: SettledAction = await Promise.race([
                reading,
                new Promise<never>((_, reject) => {
                    timeout = setTimeout(
                        () => reject(new Error('List waited for writer row locks')),
                        2000,
                    );
                }),
            ]);

            expect(result.error).toBeUndefined();
        } finally {
            if (timeout !== undefined) {
                clearTimeout(timeout);
            }

            released.release();
            await writing;
            await reading;
            Object.defineProperty(connection, 'transaction', { value: originalTransaction });
        }

        expect((await writing).error).toBeUndefined();
    }

    it('reads without waiting for Record locks and sees its medication only after commit', async (): Promise<void> => {
        const original: ListedPetMedication = await insertMedication();
        let recordedId: string | undefined;

        await whileCommitIsPending(
            async (): Promise<void> => {
                const recorded = await application.get(RecordPetMedication).execute({
                    petId,
                    authenticatedAccountId: collaboratorId,
                    name: 'Future medication',
                    startDate: '2099-01-01',
                });

                recordedId = recorded.id;
            },
            async (): Promise<void> => {
                await expect(list()).resolves.toEqual({ items: [original] });
            },
        );
        const result: PetMedications = await list();

        expect(result.items).toHaveLength(2);
        expect(result.items[0]).toMatchObject({
            id: recordedId,
            name: 'Future medication',
            startDate: '2099-01-01',
        });
        expect(result.items[1]).toEqual(original);
    });

    it.each(['leave', 'remove'] as const)(
        'reads the previous membership before concurrent %s commits and hides it afterwards',
        async (action): Promise<void> => {
            const item: ListedPetMedication = await insertMedication({
                recordedByAccountId: collaboratorId,
            });

            await whileCommitIsPending(
                async (): Promise<void> => {
                    if (action === 'leave') {
                        await application.get(LeavePet).execute(petId, collaboratorId);
                    } else {
                        await application.get(RemovePetMember).execute({
                            petId,
                            requesterAccountId: ownerId,
                            targetMembershipId: collaboratorMembershipId,
                        });
                    }
                },
                async (): Promise<void> => {
                    await expect(list(collaboratorId)).resolves.toEqual({ items: [item] });
                },
            );
            await expect(list(collaboratorId)).rejects.toThrow(PetNotFoundError);
            await expect(list()).resolves.toEqual({ items: [item] });
        },
    );

    it('remains readable before and after a concurrent Archive commit', async (): Promise<void> => {
        const item: ListedPetMedication = await insertMedication();

        await whileCommitIsPending(
            () => application.get(ArchivePet).execute({ petId, requesterAccountId: ownerId }),
            async (): Promise<void> => {
                await expect(list(collaboratorId)).resolves.toEqual({ items: [item] });
            },
        );
        await expect(list(ownerId)).resolves.toEqual({ items: [item] });
        await expect(list(collaboratorId)).resolves.toEqual({ items: [item] });
    });
});
