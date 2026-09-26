import { Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import type {
  AccessiblePetSummary,
  PetDetail,
  PetQueryRepository,
} from '../../../application/persistence/pet-query.repository';
import type { BirthDateAccuracy } from '../../../domain/birth-information/birth-information.types';
import type { BreedKind } from '../../../domain/breed/breed.types';
import type { PetMembershipRole } from '../../../domain/pet-membership/pet-membership.types';
import {
  PetMembershipRole as PetMembershipRoleValue,
  PetMembershipStatus,
} from '../../../domain/pet-membership/pet-membership';
import { PetStatus } from '../../../domain/pet/pet';
import type {
  PetSex,
  PetSpecies,
  PetStatus as PetStatusType,
} from '../../../domain/pet/pet.types';
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
          eq(petMemberships.status, PetMembershipStatus.ACTIVE),
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

  async findAccessibleDetailById(
    petId: string,
    accountId: string,
  ): Promise<PetDetail | null> {
    const rows = await this.databaseService.connection
      .select({
        id: pets.id,
        name: pets.name,
        species: pets.species,
        breedName: pets.breedName,
        breedKind: pets.breedKind,
        sex: pets.sex,
        birthDate: pets.birthDate,
        birthDateAccuracy: pets.birthDateAccuracy,
        color: pets.color,
        distinctiveMarks: pets.distinctiveMarks,
        microchip: pets.microchip,
        status: pets.status,
        role: petMemberships.role,
      })
      .from(pets)
      .innerJoin(petMemberships, eq(petMemberships.petId, pets.id))
      .where(
        and(
          eq(pets.id, petId),
          eq(petMemberships.accountId, accountId),
          eq(petMemberships.status, PetMembershipStatus.ACTIVE),
          eq(pets.status, PetStatus.ACTIVE),
        ),
      )
      .limit(1);
    const row = rows[0];

    if (row === undefined) {
      return null;
    }

    return {
      id: row.id,
      name: row.name,
      species: row.species as PetSpecies,
      breed: {
        name: row.breedName,
        kind: row.breedKind as BreedKind,
      },
      sex: row.sex as PetSex,
      birthInformation: {
        date: row.birthDate,
        accuracy: row.birthDateAccuracy as BirthDateAccuracy,
      },
      color: row.color,
      distinctiveMarks: row.distinctiveMarks,
      microchip: row.microchip,
      status: row.status as PetStatusType,
      role: row.role as PetMembershipRole,
    };
  }

  async hasActiveOwnerAccess(
    petId: string,
    accountId: string,
  ): Promise<boolean> {
    const rows = await this.databaseService.connection
      .select({ id: pets.id })
      .from(pets)
      .innerJoin(petMemberships, eq(petMemberships.petId, pets.id))
      .where(
        and(
          eq(pets.id, petId),
          eq(pets.status, PetStatus.ACTIVE),
          eq(petMemberships.accountId, accountId),
          eq(petMemberships.status, PetMembershipStatus.ACTIVE),
          eq(petMemberships.role, PetMembershipRoleValue.OWNER),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  async hasActiveMembership(
    petId: string,
    accountId: string,
  ): Promise<boolean> {
    const rows = await this.databaseService.connection
      .select({ id: petMemberships.id })
      .from(petMemberships)
      .where(
        and(
          eq(petMemberships.petId, petId),
          eq(petMemberships.accountId, accountId),
          eq(petMemberships.status, PetMembershipStatus.ACTIVE),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }
}
