import { Injectable } from '@nestjs/common';
import type { PetRepository } from '../../../application/persistence/pet.repository';
import type { Pet } from '../../../domain/pet/pet';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import { petMemberships, pets } from './pet-management.schema';

@Injectable()
export class DrizzlePetRepository implements PetRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async save(pet: Pet): Promise<void> {
    await this.databaseService.connection.transaction(async (transaction) => {
      await transaction.insert(pets).values({
        id: pet.id.value,
        name: pet.name,
        species: pet.species,
        breedName: pet.breed.name,
        breedKind: pet.breed.kind,
        sex: pet.sex,
        birthDate: pet.birthInformation.date,
        birthDateAccuracy: pet.birthInformation.accuracy,
        color: pet.color ?? null,
        distinctiveMarks: pet.distinctiveMarks ?? null,
        microchip: pet.microchip ?? null,
        status: pet.status,
      });

      await transaction.insert(petMemberships).values(
        pet.memberships.map((membership) => ({
          id: membership.id.value,
          petId: pet.id.value,
          accountId: membership.accountId.value,
          role: membership.role,
        })),
      );
    });
  }
}
