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

      expect(savedPets).toEqual([
        {
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
        },
      ]);
      expect(savedMemberships).toEqual([
        {
          id: pet.memberships[0].id.value,
          petId: pet.id.value,
          accountId: OWNER_ACCOUNT_ID,
          role: 'OWNER',
        },
      ]);
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
});
