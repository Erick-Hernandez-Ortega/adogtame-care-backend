import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { DatabaseService } from '../../src/infrastructure/database/database.service';
import type {
  AccessiblePetSummary,
  PetDetail,
} from '../../src/pet-management/application/persistence/pet-query.repository';
import { DrizzlePetQueryRepository } from '../../src/pet-management/infrastructure/persistence/drizzle/drizzle-pet-query.repository';
import {
  petMemberships,
  pets,
} from '../../src/pet-management/infrastructure/persistence/drizzle/pet-management.schema';

describe('DrizzlePetQueryRepository (integration)', () => {
  let application: INestApplicationContext;
  let databaseService: DatabaseService;
  let repository: DrizzlePetQueryRepository;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    application = moduleFixture;
    databaseService = application.get(DatabaseService);
    repository = application.get(DrizzlePetQueryRepository);
  });

  afterAll(async () => {
    await application.close();
  });

  it('projects active and archived pets for only active memberships of the requested account', async () => {
    const accountAId: string = randomUUID();
    const accountBId: string = randomUUID();
    const otherOwnerId: string = randomUUID();
    const pet1Id: string = randomUUID();
    const pet2Id: string = randomUUID();
    const pet3Id: string = randomUUID();
    const pet4Id: string = randomUUID();
    const pet5Id: string = randomUUID();
    const petIds: string[] = [pet1Id, pet2Id, pet3Id, pet4Id, pet5Id];

    try {
      await databaseService.connection.insert(pets).values([
        {
          id: pet1Id,
          name: 'Luna',
          species: 'DOG',
          breedName: 'Labrador Retriever',
          breedKind: 'KNOWN',
          sex: 'FEMALE',
          birthDate: '2021-06-14',
          birthDateAccuracy: 'EXACT',
          color: 'Golden',
          distinctiveMarks: 'White paw',
          microchip: '985141000000001',
          status: 'ACTIVE',
        },
        {
          id: pet2Id,
          name: 'Rocky',
          species: 'CAT',
          breedName: 'Mixed',
          breedKind: 'CUSTOM',
          sex: 'MALE',
          birthDate: '2020-01-01',
          birthDateAccuracy: 'APPROXIMATE',
          status: 'ACTIVE',
        },
        {
          id: pet3Id,
          name: 'Inactive membership',
          species: 'DOG',
          breedName: 'Mixed',
          breedKind: 'CUSTOM',
          sex: 'UNKNOWN',
          birthDate: '2019-01-01',
          birthDateAccuracy: 'APPROXIMATE',
          status: 'ACTIVE',
        },
        {
          id: pet4Id,
          name: 'Archived',
          species: 'DOG',
          breedName: 'Mixed',
          breedKind: 'CUSTOM',
          sex: 'UNKNOWN',
          birthDate: '2019-01-01',
          birthDateAccuracy: 'APPROXIMATE',
          status: 'ARCHIVED',
        },
        {
          id: pet5Id,
          name: 'Other account',
          species: 'CAT',
          breedName: 'Domestic Shorthair',
          breedKind: 'KNOWN',
          sex: 'FEMALE',
          birthDate: '2022-01-01',
          birthDateAccuracy: 'EXACT',
          status: 'ACTIVE',
        },
      ]);
      await databaseService.connection.insert(petMemberships).values([
        {
          id: randomUUID(),
          petId: pet1Id,
          accountId: accountAId,
          role: 'OWNER',
          status: 'ACTIVE',
        },
        {
          id: randomUUID(),
          petId: pet2Id,
          accountId: otherOwnerId,
          role: 'OWNER',
          status: 'ACTIVE',
        },
        {
          id: randomUUID(),
          petId: pet2Id,
          accountId: accountAId,
          role: 'COLLABORATOR',
          status: 'ACTIVE',
        },
        {
          id: randomUUID(),
          petId: pet3Id,
          accountId: accountAId,
          role: 'OWNER',
          status: 'INACTIVE',
        },
        {
          id: randomUUID(),
          petId: pet4Id,
          accountId: accountAId,
          role: 'OWNER',
          status: 'ACTIVE',
        },
        {
          id: randomUUID(),
          petId: pet5Id,
          accountId: accountBId,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      ]);

      const summaries: AccessiblePetSummary[] =
        await repository.findAccessibleByAccountId(accountAId);

      expect(summaries).toEqual([
        {
          id: pet4Id,
          name: 'Archived',
          species: 'DOG',
          breed: { name: 'Mixed', kind: 'CUSTOM' },
          sex: 'UNKNOWN',
          role: 'OWNER',
          status: 'ARCHIVED',
        },
        {
          id: pet1Id,
          name: 'Luna',
          species: 'DOG',
          breed: { name: 'Labrador Retriever', kind: 'KNOWN' },
          sex: 'FEMALE',
          role: 'OWNER',
          status: 'ACTIVE',
        },
        {
          id: pet2Id,
          name: 'Rocky',
          species: 'CAT',
          breed: { name: 'Mixed', kind: 'CUSTOM' },
          sex: 'MALE',
          role: 'COLLABORATOR',
          status: 'ACTIVE',
        },
      ]);
      await expect(
        repository.findAccessibleByAccountId(randomUUID()),
      ).resolves.toEqual([]);

      const ownedDetail: PetDetail | null =
        await repository.findAccessibleDetailById(pet1Id, accountAId);
      expect(ownedDetail).toEqual({
        id: pet1Id,
        name: 'Luna',
        species: 'DOG',
        breed: { name: 'Labrador Retriever', kind: 'KNOWN' },
        sex: 'FEMALE',
        birthInformation: { date: '2021-06-14', accuracy: 'EXACT' },
        color: 'Golden',
        distinctiveMarks: 'White paw',
        microchip: '985141000000001',
        status: 'ACTIVE',
        role: 'OWNER',
      });

      const collaboratorDetail: PetDetail | null =
        await repository.findAccessibleDetailById(pet2Id, accountAId);
      expect(collaboratorDetail).toEqual({
        id: pet2Id,
        name: 'Rocky',
        species: 'CAT',
        breed: { name: 'Mixed', kind: 'CUSTOM' },
        sex: 'MALE',
        birthInformation: { date: '2020-01-01', accuracy: 'APPROXIMATE' },
        color: null,
        distinctiveMarks: null,
        microchip: null,
        status: 'ACTIVE',
        role: 'COLLABORATOR',
      });

      await expect(
        repository.findAccessibleDetailById(pet3Id, accountAId),
      ).resolves.toBeNull();
      await expect(
        repository.findAccessibleDetailById(pet4Id, accountAId),
      ).resolves.toMatchObject({
        id: pet4Id,
        status: 'ARCHIVED',
        role: 'OWNER',
      });
      await expect(
        repository.findAccessibleDetailById(pet5Id, accountAId),
      ).resolves.toBeNull();
      await expect(
        repository.findAccessibleDetailById(randomUUID(), accountAId),
      ).resolves.toBeNull();

      await expect(
        repository.hasActiveOwnerAccess(pet1Id, accountAId),
      ).resolves.toBe(true);
      for (const inaccessiblePetId of [
        pet2Id,
        pet3Id,
        pet4Id,
        pet5Id,
        randomUUID(),
      ]) {
        await expect(
          repository.hasActiveOwnerAccess(inaccessiblePetId, accountAId),
        ).resolves.toBe(false);
      }

      await expect(
        repository.hasActiveMembership(pet1Id, accountAId),
      ).resolves.toBe(true);
      await expect(
        repository.hasActiveMembership(pet2Id, accountAId),
      ).resolves.toBe(true);
      await expect(
        repository.hasActiveMembership(pet3Id, accountAId),
      ).resolves.toBe(false);
      await expect(
        repository.hasActiveMembership(pet5Id, accountAId),
      ).resolves.toBe(false);
    } finally {
      await databaseService.connection
        .delete(petMemberships)
        .where(inArray(petMemberships.petId, petIds));
      await databaseService.connection
        .delete(pets)
        .where(inArray(pets.id, petIds));
    }
  });

  it('orders equal names by pet ID', async () => {
    const accountId: string = randomUUID();
    const [firstPetId, secondPetId]: string[] = [
      randomUUID(),
      randomUUID(),
    ].sort();

    try {
      await databaseService.connection.insert(pets).values(
        [secondPetId, firstPetId].map((id) => ({
          id,
          name: 'Same name',
          species: 'DOG',
          breedName: 'Mixed',
          breedKind: 'CUSTOM',
          sex: 'UNKNOWN',
          birthDate: '2020-01-01',
          birthDateAccuracy: 'APPROXIMATE',
          status: 'ACTIVE',
        })),
      );
      await databaseService.connection.insert(petMemberships).values(
        [secondPetId, firstPetId].map((petId) => ({
          id: randomUUID(),
          petId,
          accountId,
          role: 'OWNER',
          status: 'ACTIVE',
        })),
      );

      const summaries: AccessiblePetSummary[] =
        await repository.findAccessibleByAccountId(accountId);

      expect(summaries.map((summary) => summary.id)).toEqual([
        firstPetId,
        secondPetId,
      ]);
    } finally {
      await databaseService.connection
        .delete(petMemberships)
        .where(inArray(petMemberships.petId, [firstPetId, secondPetId]));
      await databaseService.connection
        .delete(pets)
        .where(inArray(pets.id, [firstPetId, secondPetId]));
    }
  });
});
