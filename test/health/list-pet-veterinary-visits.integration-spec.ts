import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import {
    ListPetVeterinaryVisits,
    PetNotFoundError,
    type PetVeterinaryVisits,
} from '../../src/health/application/list-pet-veterinary-visits/list-pet-veterinary-visits';
import type { PetVeterinaryVisitListItem } from '../../src/health/application/persistence/pet-veterinary-visit.reader';
import { RecordPetVeterinaryVisit } from '../../src/health/application/record-pet-veterinary-visit/record-pet-veterinary-visit';
import { healthPetVeterinaryVisits } from '../../src/health/infrastructure/persistence/drizzle/health.schema';
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

interface VeterinaryVisitFixtureInput {
    readonly id?: string;
    readonly petId?: string;
    readonly reason?: string;
    readonly visitDate?: string;
    readonly diagnosis?: string | null;
    readonly observations?: string | null;
    readonly recordedByAccountId?: string;
    readonly createdAt?: string;
}

const HIGH_ID: string = '10000000-0000-4000-8000-000000000004';
const MIDDLE_ID: string = '10000000-0000-4000-8000-000000000003';
const LOW_ID: string = '10000000-0000-4000-8000-000000000002';
const LOWEST_ID: string = '10000000-0000-4000-8000-000000000001';

describe('ListPetVeterinaryVisits with PostgreSQL (integration)', () => {
    let application: INestApplicationContext;
    let database: DatabaseService;
    let listPetVeterinaryVisits: ListPetVeterinaryVisits;
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
        listPetVeterinaryVisits = application.get(ListPetVeterinaryVisits);
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
                name: 'Veterinary visit pet',
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
            .delete(healthPetVeterinaryVisits)
            .where(inArray(healthPetVeterinaryVisits.petId, [petId, otherPetId]));
        await database.connection
            .delete(petMemberships)
            .where(inArray(petMemberships.petId, [petId, otherPetId]));
        await database.connection.delete(pets).where(inArray(pets.id, [petId, otherPetId]));
        await database.connection
            .delete(accounts)
            .where(inArray(accounts.id, [ownerId, collaboratorId, outsiderId]));
    });

    async function insertVisit(
        input: VeterinaryVisitFixtureInput = {},
    ): Promise<PetVeterinaryVisitListItem> {
        const item: PetVeterinaryVisitListItem = {
            id: input.id ?? randomUUID(),
            reason: input.reason ?? 'Annual checkup',
            visitDate: input.visitDate ?? '2026-03-14',
            diagnosis: input.diagnosis ?? null,
            observations: input.observations ?? null,
            recordedByAccountId: input.recordedByAccountId ?? ownerId,
        };
        const createdAt: string = input.createdAt ?? '2026-10-01T12:00:00.123456Z';

        await database.connection.insert(healthPetVeterinaryVisits).values({
            ...item,
            petId: input.petId ?? petId,
            createdAt: sql`${createdAt}::timestamptz`,
        });

        return item;
    }

    function list(
        accountId: string = ownerId,
        requestedPetId: string = petId,
    ): Promise<PetVeterinaryVisits> {
        return listPetVeterinaryVisits.execute({
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
            const item: PetVeterinaryVisitListItem = await insertVisit({
                observations: 'Reported seizures.',
            });

            await database.connection.update(pets).set({ status }).where(eq(pets.id, petId));
            const accountId: string = role === 'OWNER' ? ownerId : collaboratorId;

            await expect(list(accountId)).resolves.toEqual({ nextCursor: null, items: [item] });
        },
    );

    it.each(['ACTIVE', 'ARCHIVED'] as const)(
        'returns an empty collection for an accessible %s pet',
        async (status): Promise<void> => {
            await database.connection.update(pets).set({ status }).where(eq(pets.id, petId));

            for (const accountId of [ownerId, collaboratorId]) {
                await expect(list(accountId)).resolves.toEqual({ nextCursor: null, items: [] });
            }
        },
    );

    it.each(['ACTIVE', 'ARCHIVED'] as const)(
        'hides an %s pet from inactive authors and outsiders',
        async (status): Promise<void> => {
            await insertVisit();
            await insertVisit({ recordedByAccountId: collaboratorId });
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

    it('orders visit dates, then microsecond timestamps and UUIDs descending', async (): Promise<void> => {
        const oldestDate: PetVeterinaryVisitListItem = await insertVisit({
            id: HIGH_ID,
            visitDate: '2025-01-01',
            createdAt: '2026-10-03T12:00:00Z',
        });
        const tiedLow: PetVeterinaryVisitListItem = await insertVisit({
            id: LOW_ID,
        });
        const newestTimestamp: PetVeterinaryVisitListItem = await insertVisit({
            id: LOWEST_ID,
            recordedByAccountId: collaboratorId,
            createdAt: '2026-10-01T12:00:00.123457Z',
        });
        const tiedHigh: PetVeterinaryVisitListItem = await insertVisit({
            id: MIDDLE_ID,
        });

        await insertVisit({ petId: otherPetId, visitDate: '2026-10-01' });
        await expect(list()).resolves.toEqual({
            nextCursor: null,
            items: [newestTimestamp, tiedHigh, tiedLow, oldestDate],
        });
    });

    it('returns duplicates independently and supports an explicit larger page', async (): Promise<void> => {
        const items: PetVeterinaryVisitListItem[] = [];

        for (let itemIndex: number = 0; itemIndex < 25; itemIndex += 1) {
            items.push(await insertVisit());
        }

        items.sort(
            (
                firstItem: PetVeterinaryVisitListItem,
                secondItem: PetVeterinaryVisitListItem,
            ): number => secondItem.id.localeCompare(firstItem.id),
        );
        const page = await list();

        expect(page.items).toEqual(items.slice(0, 20));
        expect(page.nextCursor).not.toBeNull();
        const continuation = await listPetVeterinaryVisits.execute({
            petId,
            authenticatedAccountId: ownerId,
            cursor: page.nextCursor,
        });

        expect(continuation).toEqual({ items: items.slice(20), nextCursor: null });
        await database.connection
            .update(petMemberships)
            .set({ status: 'INACTIVE' })
            .where(and(eq(petMemberships.petId, petId), eq(petMemberships.accountId, ownerId)));
        await expect(
            listPetVeterinaryVisits.execute({
                petId,
                authenticatedAccountId: ownerId,
                cursor: page.nextCursor,
            }),
        ).rejects.toThrow(PetNotFoundError);
    });

    it('preserves the read result through real Archive and Restore use cases', async (): Promise<void> => {
        await application.get(RecordPetVeterinaryVisit).execute({
            petId,
            authenticatedAccountId: ownerId,
            reason: 'Routine examination',
            visitDate: '2025-01-01',
        });
        const original: PetVeterinaryVisits = await list();

        await application.get(ArchivePet).execute({ petId, requesterAccountId: ownerId });
        await expect(list()).resolves.toEqual(original);
        await expect(list(collaboratorId)).resolves.toEqual(original);
        await application.get(RestorePet).execute({ petId, requesterAccountId: ownerId });
        await expect(list()).resolves.toEqual(original);
    });

    it.each(['leave', 'remove'] as const)(
        'revokes an author access after %s while preserving visits for the owner',
        async (action): Promise<void> => {
            await insertVisit({ recordedByAccountId: collaboratorId });
            const original: PetVeterinaryVisits = await list(collaboratorId);

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

    it('reads without waiting for row locks and observes an inserted visit only after commit', async (): Promise<void> => {
        const original: PetVeterinaryVisitListItem = await insertVisit();
        const pending: PetVeterinaryVisitListItem = {
            ...original,
            id: randomUUID(),
            visitDate: '2025-01-01',
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
                    .from(healthPetVeterinaryVisits)
                    .where(eq(healthPetVeterinaryVisits.id, original.id))
                    .for('update');
                await transaction.insert(healthPetVeterinaryVisits).values({ ...pending, petId });
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
            expect(result.value).toEqual({ nextCursor: null, items: [original] });
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
        await expect(list()).resolves.toEqual({ nextCursor: null, items: [original, pending] });
    });

    it('does not change visit, pet, or membership timestamps', async (): Promise<void> => {
        await insertVisit();
        const beforeVisits = await database.connection
            .select()
            .from(healthPetVeterinaryVisits)
            .where(eq(healthPetVeterinaryVisits.petId, petId));
        const beforePets = await database.connection.select().from(pets).where(eq(pets.id, petId));
        const beforeMemberships = await database.connection
            .select()
            .from(petMemberships)
            .where(eq(petMemberships.petId, petId));

        await list();
        await list(collaboratorId);

        expect(
            await database.connection
                .select()
                .from(healthPetVeterinaryVisits)
                .where(eq(healthPetVeterinaryVisits.petId, petId)),
        ).toEqual(beforeVisits);
        expect(await database.connection.select().from(pets).where(eq(pets.id, petId))).toEqual(
            beforePets,
        );
        expect(
            await database.connection
                .select()
                .from(petMemberships)
                .where(eq(petMemberships.petId, petId)),
        ).toEqual(beforeMemberships);
    });

    it('retains only the primary key and the non-unique pet history index', async (): Promise<void> => {
        const rows = await database.connection.execute(
            sql`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'health_pet_veterinary_visits' ORDER BY indexname`,
        );

        expect(rows.map((row): unknown => row.indexname)).toEqual([
            'health_pet_veterinary_visits_pet_history_idx',
            'health_pet_veterinary_visits_pkey',
        ]);
        expect(rows[0]?.indexdef).toContain('USING btree (pet_id, visit_date DESC NULLS LAST)');
        expect(rows[0]?.indexdef).not.toContain('UNIQUE');
    });
});
