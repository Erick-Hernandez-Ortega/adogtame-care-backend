import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import {
    ListPetMedicalConditions,
    PetNotFoundError,
    type PetMedicalConditions,
} from '../../src/health/application/list-pet-medical-conditions/list-pet-medical-conditions';
import type { PetMedicalConditionListItem } from '../../src/health/application/persistence/pet-medical-condition.reader';
import { RecordPetMedicalCondition } from '../../src/health/application/record-pet-medical-condition/record-pet-medical-condition';
import { healthPetMedicalConditions } from '../../src/health/infrastructure/persistence/drizzle/health.schema';
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

interface MedicalConditionFixtureInput {
    readonly id?: string;
    readonly petId?: string;
    readonly name?: string;
    readonly status?: PetMedicalConditionListItem['status'];
    readonly diagnosedDate?: string | null;
    readonly notes?: string | null;
    readonly recordedByAccountId?: string;
    readonly createdAt?: string;
}

const HIGH_ID: string = '10000000-0000-4000-8000-000000000004';
const MIDDLE_ID: string = '10000000-0000-4000-8000-000000000003';
const LOW_ID: string = '10000000-0000-4000-8000-000000000002';
const LOWEST_ID: string = '10000000-0000-4000-8000-000000000001';

describe('ListPetMedicalConditions with PostgreSQL (integration)', () => {
    let application: INestApplicationContext;
    let database: DatabaseService;
    let listPetMedicalConditions: ListPetMedicalConditions;
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
        listPetMedicalConditions = application.get(ListPetMedicalConditions);
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
                name: 'Medical condition pet',
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
            .delete(healthPetMedicalConditions)
            .where(inArray(healthPetMedicalConditions.petId, [petId, otherPetId]));
        await database.connection
            .delete(petMemberships)
            .where(inArray(petMemberships.petId, [petId, otherPetId]));
        await database.connection.delete(pets).where(inArray(pets.id, [petId, otherPetId]));
        await database.connection
            .delete(accounts)
            .where(inArray(accounts.id, [ownerId, collaboratorId, outsiderId]));
    });

    async function insertCondition(
        input: MedicalConditionFixtureInput = {},
    ): Promise<PetMedicalConditionListItem> {
        const item: PetMedicalConditionListItem = {
            id: input.id ?? randomUUID(),
            name: input.name ?? 'Epilepsy',
            status: input.status ?? 'ACTIVE',
            resolvedDate: null,
            diagnosedDate: input.diagnosedDate === undefined ? '2026-03-14' : input.diagnosedDate,
            notes: input.notes ?? null,
            recordedByAccountId: input.recordedByAccountId ?? ownerId,
        };
        const createdAt: string = input.createdAt ?? '2026-10-01T12:00:00.123456Z';

        await database.connection.insert(healthPetMedicalConditions).values({
            ...item,
            petId: input.petId ?? petId,
            createdAt: sql`${createdAt}::timestamptz`,
        });

        return item;
    }

    function list(
        accountId: string = ownerId,
        requestedPetId: string = petId,
    ): Promise<PetMedicalConditions> {
        return listPetMedicalConditions.execute({
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
            const item: PetMedicalConditionListItem = await insertCondition({
                notes: 'Reported seizures.',
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
            await insertCondition();
            await insertCondition({ recordedByAccountId: collaboratorId });
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

    it('orders known diagnosis dates first, then microsecond timestamps and UUIDs, with unknown dates last', async (): Promise<void> => {
        const oldestDate: PetMedicalConditionListItem = await insertCondition({
            id: HIGH_ID,
            diagnosedDate: '2025-01-01',
            createdAt: '2026-10-03T12:00:00Z',
        });
        const tiedLow: PetMedicalConditionListItem = await insertCondition({
            id: LOW_ID,
        });
        const newestTimestamp: PetMedicalConditionListItem = await insertCondition({
            id: LOWEST_ID,
            status: 'RESOLVED',
            recordedByAccountId: collaboratorId,
            createdAt: '2026-10-01T12:00:00.123457Z',
        });
        const tiedHigh: PetMedicalConditionListItem = await insertCondition({
            id: MIDDLE_ID,
        });
        const unknownLow: PetMedicalConditionListItem = await insertCondition({
            diagnosedDate: null,
            createdAt: '2026-10-04T12:00:00Z',
            id: '10000000-0000-4000-8000-000000000005',
        });
        const unknownHigh: PetMedicalConditionListItem = await insertCondition({
            diagnosedDate: null,
            createdAt: '2026-10-04T12:00:00Z',
            id: '10000000-0000-4000-8000-000000000006',
        });
        const unknownOld: PetMedicalConditionListItem = await insertCondition({
            diagnosedDate: null,
            createdAt: '2026-10-03T12:00:00Z',
        });

        await insertCondition({ petId: otherPetId, diagnosedDate: '2026-10-01' });
        await expect(list()).resolves.toEqual({
            items: [
                newestTimestamp,
                tiedHigh,
                tiedLow,
                oldestDate,
                unknownHigh,
                unknownLow,
                unknownOld,
            ],
        });
    });

    it('returns duplicates independently and never applies a hidden page limit', async (): Promise<void> => {
        const items: PetMedicalConditionListItem[] = [];

        for (let itemIndex: number = 0; itemIndex < 25; itemIndex += 1) {
            items.push(await insertCondition());
        }

        items.sort(
            (
                firstItem: PetMedicalConditionListItem,
                secondItem: PetMedicalConditionListItem,
            ): number => secondItem.id.localeCompare(firstItem.id),
        );
        await expect(list()).resolves.toEqual({ items });
    });

    it('preserves the read result through real Archive and Restore use cases', async (): Promise<void> => {
        await application.get(RecordPetMedicalCondition).execute({
            petId,
            authenticatedAccountId: ownerId,
            name: 'Diabetes',
            diagnosedDate: null,
        });
        const original: PetMedicalConditions = await list();

        await application.get(ArchivePet).execute({ petId, requesterAccountId: ownerId });
        await expect(list()).resolves.toEqual(original);
        await expect(list(collaboratorId)).resolves.toEqual(original);
        await application.get(RestorePet).execute({ petId, requesterAccountId: ownerId });
        await expect(list()).resolves.toEqual(original);
    });

    it.each(['leave', 'remove'] as const)(
        'revokes an author access after %s while preserving conditions for the owner',
        async (action): Promise<void> => {
            await insertCondition({ recordedByAccountId: collaboratorId });
            const original: PetMedicalConditions = await list(collaboratorId);

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

    it('reads without waiting for row locks and observes an inserted condition only after commit', async (): Promise<void> => {
        const original: PetMedicalConditionListItem = await insertCondition();
        const pending: PetMedicalConditionListItem = {
            ...original,
            id: randomUUID(),
            status: 'RESOLVED',
            diagnosedDate: null,
        };
        const acquired: Barrier = barrier();
        const released: Barrier = barrier();
        const writer: Promise<SettledAction> = settle(
            database.connection.transaction(async (transaction): Promise<void> => {
                await transaction.execute(sql`SET LOCAL statement_timeout = '5000ms'`);
                await transaction.select().from(pets).where(eq(pets.id, petId)).for('update');
                await transaction
                    .select()
                    .from(petMemberships)
                    .where(eq(petMemberships.petId, petId))
                    .for('update');
                await transaction
                    .select()
                    .from(healthPetMedicalConditions)
                    .where(eq(healthPetMedicalConditions.id, original.id))
                    .for('update');
                await transaction.insert(healthPetMedicalConditions).values({ ...pending, petId });
                acquired.release();
                await released.promise;
            }),
        );
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let reading: Promise<SettledAction> | undefined;

        try {
            await Promise.race([
                acquired.promise,
                writer.then((result: SettledAction): never => {
                    if (result.error instanceof Error) {
                        throw result.error;
                    }

                    throw new Error('Writer ended before acquiring locks', {
                        cause: result.error,
                    });
                }),
            ]);
            reading = settle(list());
            const result: SettledAction = await Promise.race([
                reading,
                new Promise<never>((_, reject) => {
                    timeout = setTimeout(
                        () => reject(new Error('List waited for row locks')),
                        2000,
                    );
                }),
            ]);

            expect(result.error).toBeUndefined();
            expect(result.value).toEqual({ items: [original] });
        } finally {
            if (timeout !== undefined) {
                clearTimeout(timeout);
            }

            released.release();
            await writer;

            if (reading !== undefined) {
                await reading;
            }
        }

        expect((await writer).error).toBeUndefined();
        await expect(list()).resolves.toEqual({ items: [original, pending] });
    });

    it('has only the primary key and a simple non-unique pet index', async (): Promise<void> => {
        const rows = await database.connection.execute(
            sql`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'health_pet_medical_conditions' ORDER BY indexname`,
        );

        expect(rows.map((row): unknown => row.indexname)).toEqual([
            'health_pet_medical_conditions_pet_idx',
            'health_pet_medical_conditions_pkey',
        ]);
        expect(rows[0]?.indexdef).toContain('USING btree (pet_id)');
        expect(rows[0]?.indexdef).not.toContain('UNIQUE');
    });
});
