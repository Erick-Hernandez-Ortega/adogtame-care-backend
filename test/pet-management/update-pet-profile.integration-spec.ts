import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import {
    healthVaccinationRecords,
    healthWeightRecords,
} from '../../src/health/infrastructure/persistence/drizzle/health.schema';
import { accounts } from '../../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../../src/infrastructure/database/database.service';
import { PetNotFoundError } from '../../src/pet-management/application/errors/pet-not-found.error';
import {
    UpdatePetProfile,
    type UpdatePetProfileCommand,
} from '../../src/pet-management/application/update-pet-profile/update-pet-profile';
import {
    petMemberships,
    pets,
} from '../../src/pet-management/infrastructure/persistence/drizzle/pet-management.schema';

describe('UpdatePetProfile with PostgreSQL (integration)', () => {
    let application: INestApplicationContext;
    let database: DatabaseService;
    let updateProfile: UpdatePetProfile;
    let petId: string;
    let ownerId: string;
    let collaboratorId: string;
    let outsiderId: string;
    let ownerMembershipId: string;

    beforeAll(async () => {
        const fixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        application = fixture;
        database = application.get(DatabaseService);
        updateProfile = application.get(UpdatePetProfile);
    });

    afterAll(async () => {
        await application.close();
    });

    beforeEach(async () => {
        petId = randomUUID();
        ownerId = randomUUID();
        collaboratorId = randomUUID();
        outsiderId = randomUUID();
        ownerMembershipId = randomUUID();
        await database.connection.insert(accounts).values(
            [ownerId, collaboratorId, outsiderId].map((id) => ({
                id,
                email: `${id}@example.com`,
                passwordHash: 'test-hash',
            })),
        );
        await database.connection.insert(pets).values({
            id: petId,
            name: 'Luna',
            species: 'DOG',
            breedName: 'Labrador Retriever',
            breedKind: 'KNOWN',
            sex: 'FEMALE',
            birthDate: '2021-06-14',
            birthDateAccuracy: 'EXACT',
            color: 'Golden',
            distinctiveMarks: 'White spot',
            microchip: '12345',
            status: 'ACTIVE',
            createdAt: new Date('2020-01-01T00:00:00.000Z'),
            updatedAt: new Date('2020-01-02T00:00:00.000Z'),
        });
        await database.connection.insert(petMemberships).values([
            {
                id: ownerMembershipId,
                petId,
                accountId: ownerId,
                role: 'OWNER',
                status: 'ACTIVE',
            },
            {
                id: randomUUID(),
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
        await database.connection
            .delete(healthWeightRecords)
            .where(eq(healthWeightRecords.petId, petId));
        await database.connection.delete(petMemberships).where(eq(petMemberships.petId, petId));
        await database.connection.delete(pets).where(eq(pets.id, petId));
        await database.connection.delete(accounts).where(eq(accounts.id, ownerId));
        await database.connection.delete(accounts).where(eq(accounts.id, collaboratorId));
        await database.connection.delete(accounts).where(eq(accounts.id, outsiderId));
    });

    function update(patch: Partial<UpdatePetProfileCommand>, accountId: string = ownerId) {
        return updateProfile.execute({
            petId,
            authenticatedAccountId: accountId,
            ...patch,
        });
    }

    async function petRow() {
        return (await database.connection.select().from(pets).where(eq(pets.id, petId)))[0];
    }

    async function waitForLockWaiters(count: number, table: string = 'pets'): Promise<void> {
        for (let attempt = 0; attempt < 200; attempt += 1) {
            const rows = await database.connection.execute(
                sql`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE ${`%${table}%`}`,
            );

            if (Number(rows[0]?.waiting ?? 0) >= count) {
                return;
            }

            await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }

        throw new Error(`Expected ${count} pet lock waiters`);
    }

    it('updates all profile fields as a final state and preserves memberships and Health records', async () => {
        const weightId: string = randomUUID();
        const vaccinationId: string = randomUUID();

        await database.connection.insert(healthWeightRecords).values({
            id: weightId,
            petId,
            weightKg: '12.0000',
            measuredDate: '2025-01-01',
            recordedByAccountId: ownerId,
        });
        await database.connection.insert(healthVaccinationRecords).values({
            id: vaccinationId,
            petId,
            vaccineName: 'Rabies',
            appliedDate: '2025-01-01',
            nextDueDate: null,
            recordedByAccountId: ownerId,
        });
        const membershipsBefore = await database.connection
            .select()
            .from(petMemberships)
            .where(eq(petMemberships.petId, petId));

        const result = await update({
            name: ' Nala ',
            species: 'CAT',
            breed: { name: ' Domestic shorthair ', kind: 'CUSTOM' },
            sex: 'UNKNOWN',
            birthInformation: { date: '2020-01-02', accuracy: 'APPROXIMATE' },
            color: ' Black ',
            distinctiveMarks: ' White paws ',
            microchip: ' 98765 ',
        });

        expect(result).toMatchObject({
            id: petId,
            name: 'Nala',
            species: 'CAT',
            breed: { name: 'Domestic shorthair', kind: 'CUSTOM' },
            sex: 'UNKNOWN',
            birthInformation: { date: '2020-01-02', accuracy: 'APPROXIMATE' },
            color: 'Black',
            distinctiveMarks: 'White paws',
            microchip: '98765',
            status: 'ACTIVE',
            role: 'OWNER',
        });
        const after = await petRow();

        expect(after?.createdAt).toEqual(new Date('2020-01-01T00:00:00.000Z'));
        expect(after?.updatedAt.getTime()).toBeGreaterThan(
            new Date('2020-01-02T00:00:00.000Z').getTime(),
        );
        expect(
            await database.connection
                .select()
                .from(petMemberships)
                .where(eq(petMemberships.petId, petId)),
        ).toEqual(membershipsBefore);
        expect(
            await database.connection
                .select()
                .from(healthWeightRecords)
                .where(eq(healthWeightRecords.id, weightId)),
        ).toHaveLength(1);
        expect(
            await database.connection
                .select()
                .from(healthVaccinationRecords)
                .where(eq(healthVaccinationRecords.id, vaccinationId)),
        ).toHaveLength(1);
    });

    it.each([
        [{ name: 'Nala' }, { name: 'Nala' }],
        [{ species: 'CAT' }, { species: 'CAT' }],
        [
            { breed: { name: 'Mixed', kind: 'CUSTOM' } },
            { breed: { name: 'Mixed', kind: 'CUSTOM' } },
        ],
        [{ sex: 'MALE' }, { sex: 'MALE' }],
        [
            { birthInformation: { date: '2020-03-04', accuracy: 'APPROXIMATE' } },
            { birthInformation: { date: '2020-03-04', accuracy: 'APPROXIMATE' } },
        ],
        [{ color: 'Black' }, { color: 'Black' }],
        [{ distinctiveMarks: 'White paws' }, { distinctiveMarks: 'White paws' }],
        [{ microchip: '98765' }, { microchip: '98765' }],
    ] as const)('updates one profile concept at a time: %#', async (patch, expected) => {
        const result = await update(patch);

        expect(result).toMatchObject(expected);
        expect(await petRow()).toMatchObject({
            name: result.name,
            species: result.species,
            sex: result.sex,
            color: result.color,
            distinctiveMarks: result.distinctiveMarks,
            microchip: result.microchip,
        });
    });

    it('clears each nullable field and preserves omitted values', async () => {
        await update({ color: null });
        expect(await petRow()).toMatchObject({
            color: null,
            distinctiveMarks: 'White spot',
            microchip: '12345',
        });
        await update({ distinctiveMarks: null });
        await update({ microchip: null });
        expect(await petRow()).toMatchObject({
            color: null,
            distinctiveMarks: null,
            microchip: null,
        });
    });

    it('skips physical UPDATE for normalized and null no-ops', async () => {
        const before = await petRow();

        await update({
            name: '  Luna  ',
            breed: { name: ' Labrador Retriever ', kind: 'KNOWN' },
        });
        expect((await petRow())?.updatedAt).toEqual(before?.updatedAt);
        await update({ color: null });
        const afterClear = await petRow();

        await update({ color: null });
        expect((await petRow())?.updatedAt).toEqual(afterClear?.updatedAt);
    });

    it('hides collaborator, inactive owner, outsider, missing pet, and archived pet', async () => {
        await expect(update({ name: 'Nala' }, collaboratorId)).rejects.toThrow(PetNotFoundError);
        await expect(update({ name: 'Nala' }, outsiderId)).rejects.toThrow(PetNotFoundError);
        await expect(update({ name: 'Nala', petId: randomUUID() })).rejects.toThrow(
            PetNotFoundError,
        );
        await database.connection
            .update(petMemberships)
            .set({ status: 'INACTIVE' })
            .where(eq(petMemberships.id, ownerMembershipId));
        await expect(update({ name: 'Nala' })).rejects.toThrow(PetNotFoundError);
        await database.connection
            .update(petMemberships)
            .set({ status: 'ACTIVE' })
            .where(eq(petMemberships.id, ownerMembershipId));
        await database.connection
            .update(pets)
            .set({ status: 'ARCHIVED' })
            .where(eq(pets.id, petId));
        await expect(update({ name: 'Nala' })).rejects.toThrow(PetNotFoundError);
        expect((await petRow())?.name).toBe('Luna');
    });

    it.each([
        [{ name: 'Luna' }, { color: 'Black' }, { name: 'Luna', color: 'Black' }],
        [{ name: 'Nala' }, { name: 'Mila' }, { name: 'Mila' }],
    ] as const)(
        'serializes concurrent PATCH operations without lost updates',
        async (firstPatch, secondPatch, expected) => {
            let release: (() => void) | undefined;
            const barrier = new Promise<void>((resolve) => {
                release = resolve;
            });
            let ready: (() => void) | undefined;
            const locked = new Promise<void>((resolve) => {
                ready = resolve;
            });
            const blocker = database.connection.transaction(async (transaction) => {
                await transaction
                    .select({ id: pets.id })
                    .from(pets)
                    .where(eq(pets.id, petId))
                    .for('update');
                ready?.();
                await barrier;
            });

            await locked;
            const first = update(firstPatch);
            let second: Promise<unknown> | undefined;

            try {
                await waitForLockWaiters(1);
                second = update(secondPatch);
                await waitForLockWaiters(2);
            } finally {
                release?.();
                await blocker;
            }

            await Promise.all([first, second]);
            expect(await petRow()).toMatchObject(expected);
        },
    );

    it.each([
        ['membership', 'INACTIVE'],
        ['pet', 'ARCHIVED'],
    ] as const)('observes a concurrent %s change before authorizing', async (target, value) => {
        let release: (() => void) | undefined;
        const barrier = new Promise<void>((resolve) => {
            release = resolve;
        });
        let ready: (() => void) | undefined;
        const changed = new Promise<void>((resolve) => {
            ready = resolve;
        });
        const blocker = database.connection.transaction(async (transaction) => {
            if (target === 'membership') {
                await transaction
                    .update(petMemberships)
                    .set({ status: value })
                    .where(
                        and(eq(petMemberships.petId, petId), eq(petMemberships.accountId, ownerId)),
                    );
            } else {
                await transaction.update(pets).set({ status: value }).where(eq(pets.id, petId));
            }

            ready?.();
            await barrier;
        });

        await changed;
        const correction = update({ name: 'Nala' }).catch((error: unknown): unknown => error);

        try {
            await waitForLockWaiters(1, target === 'membership' ? 'pet_memberships' : 'pets');
        } finally {
            release?.();
            await blocker;
        }

        expect(await correction).toBeInstanceOf(PetNotFoundError);
        expect((await petRow())?.name).toBe('Luna');
    });
});
