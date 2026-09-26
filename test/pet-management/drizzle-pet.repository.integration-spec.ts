import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { BirthInformation } from '../../src/pet-management/domain/birth-information/birth-information';
import { Breed } from '../../src/pet-management/domain/breed/breed';
import { Pet } from '../../src/pet-management/domain/pet/pet';
import { DatabaseService } from '../../src/infrastructure/database/database.service';
import { DrizzlePetRepository } from '../../src/pet-management/infrastructure/persistence/drizzle/drizzle-pet.repository';
import {
  petMemberships,
  pets,
} from '../../src/pet-management/infrastructure/persistence/drizzle/pet-management.schema';

const OWNER_ACCOUNT_ID: string = '550e8400-e29b-41d4-a716-446655440000';

function createPet(): Pet {
  return Pet.register({
    name: 'Luna',
    species: 'DOG',
    breed: Breed.known('Labrador Retriever'),
    sex: 'FEMALE',
    birthInformation: BirthInformation.exact('2021-06-14'),
    ownerAccountId: OWNER_ACCOUNT_ID,
    color: 'Golden',
  });
}

describe('DrizzlePetRepository (integration)', () => {
  let application: INestApplicationContext;
  let databaseService: DatabaseService;
  let repository: DrizzlePetRepository;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    application = moduleFixture;
    databaseService = application.get(DatabaseService);
    repository = new DrizzlePetRepository(databaseService);
  });

  afterAll(async () => {
    await application.close();
  });

  it('maps and saves the pet and its initial membership', async () => {
    const pet: Pet = createPet();

    try {
      await repository.save(pet);

      const savedPets = await databaseService.connection
        .select()
        .from(pets)
        .where(eq(pets.id, pet.id.value));
      const savedMemberships = await databaseService.connection
        .select()
        .from(petMemberships)
        .where(eq(petMemberships.petId, pet.id.value));

      expect(savedPets).toHaveLength(1);
      expect(savedPets[0]).toMatchObject({
        id: pet.id.value,
        name: 'Luna',
        species: 'DOG',
        breedName: 'Labrador Retriever',
        breedKind: 'KNOWN',
        sex: 'FEMALE',
        birthDate: '2021-06-14',
        birthDateAccuracy: 'EXACT',
        color: 'Golden',
        distinctiveMarks: null,
        microchip: null,
        status: 'ACTIVE',
      });
      expect(savedPets[0].createdAt).toBeInstanceOf(Date);
      expect(savedPets[0].updatedAt).toBeInstanceOf(Date);
      expect(savedMemberships).toHaveLength(1);
      expect(savedMemberships[0]).toMatchObject({
        id: pet.memberships[0].id.value,
        petId: pet.id.value,
        accountId: OWNER_ACCOUNT_ID,
        role: 'OWNER',
        status: 'ACTIVE',
      });
      expect(savedMemberships[0].createdAt).toBeInstanceOf(Date);
      expect(savedMemberships[0].updatedAt).toBeInstanceOf(Date);
    } finally {
      await databaseService.connection
        .delete(petMemberships)
        .where(eq(petMemberships.petId, pet.id.value));
      await databaseService.connection
        .delete(pets)
        .where(eq(pets.id, pet.id.value));
    }
  });

  it('updates persistence timestamps for direct pet and membership updates', async () => {
    const pet: Pet = createPet();
    const originalCreatedAt: Date = new Date('2020-01-01T00:00:00.000Z');
    const originalUpdatedAt: Date = new Date('2020-01-02T00:00:00.000Z');

    try {
      await databaseService.connection.insert(pets).values({
        id: pet.id.value,
        name: 'Luna',
        species: 'DOG',
        breedName: 'Labrador Retriever',
        breedKind: 'KNOWN',
        sex: 'FEMALE',
        birthDate: '2021-06-14',
        birthDateAccuracy: 'EXACT',
        status: 'ACTIVE',
        createdAt: originalCreatedAt,
        updatedAt: originalUpdatedAt,
      });
      await databaseService.connection.insert(petMemberships).values({
        id: pet.memberships[0].id.value,
        petId: pet.id.value,
        accountId: OWNER_ACCOUNT_ID,
        role: 'OWNER',
        status: 'ACTIVE',
        createdAt: originalCreatedAt,
        updatedAt: originalUpdatedAt,
      });

      const [updatedPet] = await databaseService.connection
        .update(pets)
        .set({ name: 'Luna' })
        .where(eq(pets.id, pet.id.value))
        .returning();
      const [updatedMembership] = await databaseService.connection
        .update(petMemberships)
        .set({ status: 'ACTIVE' })
        .where(eq(petMemberships.id, pet.memberships[0].id.value))
        .returning();

      expect(updatedPet.createdAt).toEqual(originalCreatedAt);
      expect(updatedPet.updatedAt.getTime()).toBeGreaterThan(
        originalUpdatedAt.getTime(),
      );
      expect(updatedMembership.createdAt).toEqual(originalCreatedAt);
      expect(updatedMembership.updatedAt.getTime()).toBeGreaterThan(
        originalUpdatedAt.getTime(),
      );
    } finally {
      await databaseService.connection
        .delete(petMemberships)
        .where(eq(petMemberships.petId, pet.id.value));
      await databaseService.connection
        .delete(pets)
        .where(eq(pets.id, pet.id.value));
    }
  });

  it('rolls back the pet when membership insertion fails', async () => {
    const pet: Pet = createPet();
    const membershipId: string = pet.memberships[0].id.value;
    const blockerPetId: string = randomUUID();

    try {
      await databaseService.connection.insert(pets).values({
        id: blockerPetId,
        name: 'Blocker',
        species: 'CAT',
        breedName: 'Domestic shorthair',
        breedKind: 'KNOWN',
        sex: 'UNKNOWN',
        birthDate: '2020-01-01',
        birthDateAccuracy: 'APPROXIMATE',
        color: null,
        distinctiveMarks: null,
        microchip: null,
        status: 'ACTIVE',
      });
      await databaseService.connection.insert(petMemberships).values({
        id: membershipId,
        petId: blockerPetId,
        accountId: OWNER_ACCOUNT_ID,
        role: 'OWNER',
        status: 'ACTIVE',
      });

      await expect(repository.save(pet)).rejects.toThrow();

      const rolledBackPets = await databaseService.connection
        .select({ id: pets.id })
        .from(pets)
        .where(eq(pets.id, pet.id.value));

      expect(rolledBackPets).toHaveLength(0);
    } finally {
      await databaseService.connection
        .delete(petMemberships)
        .where(eq(petMemberships.id, membershipId));
      await databaseService.connection
        .delete(petMemberships)
        .where(eq(petMemberships.petId, pet.id.value));
      await databaseService.connection
        .delete(pets)
        .where(eq(pets.id, pet.id.value));
      await databaseService.connection
        .delete(pets)
        .where(eq(pets.id, blockerPetId));
    }
  });

  it('rejects another membership for the same pet and account regardless of status', async () => {
    const pet: Pet = createPet();

    try {
      await repository.save(pet);

      await expect(
        databaseService.connection.insert(petMemberships).values({
          id: randomUUID(),
          petId: pet.id.value,
          accountId: OWNER_ACCOUNT_ID,
          role: 'OWNER',
          status: 'INACTIVE',
        }),
      ).rejects.toMatchObject({
        cause: {
          code: '23505',
          constraint_name: 'pet_memberships_pet_id_account_id_unique',
        },
      });

      const savedMemberships = await databaseService.connection
        .select({ id: petMemberships.id })
        .from(petMemberships)
        .where(eq(petMemberships.petId, pet.id.value));
      expect(savedMemberships).toEqual([{ id: pet.memberships[0].id.value }]);
    } finally {
      await databaseService.connection
        .delete(petMemberships)
        .where(eq(petMemberships.petId, pet.id.value));
      await databaseService.connection
        .delete(pets)
        .where(eq(pets.id, pet.id.value));
    }
  });
});
