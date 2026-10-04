import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DeletePetAllergy } from '../../src/health/application/delete-pet-allergy/delete-pet-allergy';
import { AppModule } from '../../src/app.module';
import {
  PetNotFoundError,
  RecordPetAllergy,
} from '../../src/health/application/record-pet-allergy/record-pet-allergy';
import { healthPetAllergies } from '../../src/health/infrastructure/persistence/drizzle/health.schema';
import { accounts } from '../../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../../src/infrastructure/database/database.service';
import {
  petMemberships,
  pets,
} from '../../src/pet-management/infrastructure/persistence/drizzle/pet-management.schema';

import { LeavePet } from '../../src/pet-management/application/leave-pet/leave-pet';
import { PetAllergyNotFoundError } from '../../src/health/application/update-pet-allergy/update-pet-allergy';
import { ListPetAllergies } from '../../src/health/application/list-pet-allergies/list-pet-allergies';

describe('DeletePetAllergy with PostgreSQL (integration)', () => {
  let application: INestApplicationContext;
  let database: DatabaseService;
  let recordPetAllergy: RecordPetAllergy;
  let petId: string;
  let ownerId: string;
  let collaboratorId: string;
  let outsiderId: string;
  let collaboratorMembershipId: string;
  let otherPetId: string;

  beforeAll(async () => {
    const fixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    application = fixture;
    database = application.get(DatabaseService);
    recordPetAllergy = application.get(RecordPetAllergy);
  });

  afterAll(async () => {
    await application.close();
  });

  beforeEach(async () => {
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
      [petId, otherPetId].map((identifier: string) => ({
        id: identifier,
        name: 'Allergy pet',
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
      .delete(healthPetAllergies)
      .where(inArray(healthPetAllergies.petId, [petId, otherPetId]));
    await database.connection
      .delete(petMemberships)
      .where(eq(petMemberships.petId, petId));
    await database.connection
      .delete(pets)
      .where(inArray(pets.id, [petId, otherPetId]));
    for (const accountId of [ownerId, collaboratorId, outsiderId]) {
      await database.connection
        .delete(accounts)
        .where(eq(accounts.id, accountId));
    }
  });

  function create(
    accountId: string = ownerId,
    notes: string | null = '  Reported reaction.  ',
  ) {
    return recordPetAllergy.execute({
      petId,
      allergen: '  Chicken  ',
      category: 'FOOD',
      severity: 'UNKNOWN',
      notes,
      authenticatedAccountId: accountId,
    });
  }
  function rows() {
    return database.connection
      .select()
      .from(healthPetAllergies)
      .where(eq(healthPetAllergies.petId, petId));
  }

  function remove(
    allergyId: string,
    authenticatedAccountId: string = ownerId,
    targetPetId: string = petId,
  ): Promise<void> {
    return application.get(DeletePetAllergy).execute({
      petId: targetPetId,
      allergyId,
      authenticatedAccountId,
    });
  }

  it.each(['OWNER', 'COLLABORATOR'] as const)(
    'allows active %s to delete own and other authors records',
    async (role) => {
      const requesterId: string = role === 'OWNER' ? ownerId : collaboratorId;
      for (const authorId of [ownerId, collaboratorId]) {
        const created = await create(authorId);
        await expect(remove(created.id, requesterId)).resolves.toBeUndefined();
        expect(await rows()).toEqual([]);
      }
    },
  );

  it('allows deletion after the original author leaves', async () => {
    const created = await create(collaboratorId);
    await application.get(LeavePet).execute(petId, collaboratorId);
    await expect(remove(created.id)).resolves.toBeUndefined();
    expect(await rows()).toEqual([]);
  });

  it('authorizes Pet before resolving the target and preserves rows on rejection', async () => {
    const created = await create();
    const before = await rows();
    await expect(remove(created.id, ownerId, randomUUID())).rejects.toThrow(
      PetNotFoundError,
    );
    await expect(remove(created.id, outsiderId)).rejects.toThrow(
      PetNotFoundError,
    );
    await expect(remove(randomUUID(), outsiderId)).rejects.toThrow(
      PetNotFoundError,
    );
    await database.connection
      .update(petMemberships)
      .set({ status: 'INACTIVE' })
      .where(eq(petMemberships.id, collaboratorMembershipId));
    await expect(remove(created.id, collaboratorId)).rejects.toThrow(
      PetNotFoundError,
    );
    await database.connection
      .update(pets)
      .set({ status: 'ARCHIVED' })
      .where(eq(pets.id, petId));
    await expect(remove(created.id)).rejects.toThrow(PetNotFoundError);
    expect(await rows()).toEqual(before);
  });

  it('hides targets from other Pets after authorizing the requested Pet', async () => {
    const otherAllergyId: string = randomUUID();
    await database.connection.insert(healthPetAllergies).values({
      id: otherAllergyId,
      petId: otherPetId,
      allergen: 'Chicken',
      category: 'FOOD',
      severity: 'UNKNOWN',
      recordedByAccountId: ownerId,
    });
    await expect(remove(randomUUID())).rejects.toThrow(PetAllergyNotFoundError);
    await expect(remove(otherAllergyId)).rejects.toThrow(
      PetAllergyNotFoundError,
    );
    await expect(remove(otherAllergyId, ownerId, otherPetId)).rejects.toThrow(
      PetNotFoundError,
    );
    const remaining = await database.connection
      .select()
      .from(healthPetAllergies)
      .where(eq(healthPetAllergies.id, otherAllergyId));
    expect(remaining).toHaveLength(1);
  });

  it('physically deletes only the requested duplicate, updates List and rejects repetition', async () => {
    const first = await create();
    const second = await create();
    const before = await rows();
    const survivor = before.find((row) => row.id === second.id);
    await remove(first.id);
    expect(await rows()).toEqual([survivor]);
    await expect(remove(first.id)).rejects.toThrow(PetAllergyNotFoundError);
    const listed = await application
      .get(ListPetAllergies)
      .execute({ petId, authenticatedAccountId: ownerId });
    expect(listed.items).toEqual([expect.objectContaining({ id: second.id })]);
    await remove(second.id);
    expect(await rows()).toEqual([]);
    await expect(
      application
        .get(ListPetAllergies)
        .execute({ petId, authenticatedAccountId: ownerId }),
    ).resolves.toEqual({ items: [] });
  });
});
