import { Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import type {
  AccessiblePetSummary,
  PetQueryRepository,
} from '../../../application/persistence/pet-query.repository';
import type { BreedKind } from '../../../domain/breed/breed.types';
import type { PetMembershipRole } from '../../../domain/pet-membership/pet-membership.types';
import { PetStatus } from '../../../domain/pet/pet';
import type { PetSex, PetSpecies } from '../../../domain/pet/pet.types';
import { petMemberships, pets } from './pet-management.schema';

@Injectable()
export class DrizzlePetQueryRepository implements PetQueryRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async findAccessibleByAccountId(
    accountId: string,
  ): Promise<AccessiblePetSummary[]> {
    const rows = await this.databaseService.connection
      .select({
        id: pets.id,
        name: pets.name,
        species: pets.species,
        breedName: pets.breedName,
        breedKind: pets.breedKind,
        sex: pets.sex,
        role: petMemberships.role,
      })
      .from(petMemberships)
      .innerJoin(pets, eq(petMemberships.petId, pets.id))
      .where(
        and(
          eq(petMemberships.accountId, accountId),
          eq(pets.status, PetStatus.ACTIVE),
        ),
      )
      .orderBy(asc(pets.name), asc(pets.id));

    return rows.map((row): AccessiblePetSummary => ({
      id: row.id,
      name: row.name,
      species: row.species as PetSpecies,
      breed: {
        name: row.breedName,
        kind: row.breedKind as BreedKind,
      },
      sex: row.sex as PetSex,
      role: row.role as PetMembershipRole,
    }));
  }
}
