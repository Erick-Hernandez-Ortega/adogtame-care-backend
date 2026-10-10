import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import {
  petMemberships,
  pets,
} from '../../../../pet-management/infrastructure/persistence/drizzle/pet-management.schema';
import type {
  PetMedicalConditionListItem,
  PetMedicalConditionReader,
  PetMedicalConditionReadRequest,
} from '../../../application/persistence/pet-medical-condition.reader';
import type { MedicalConditionStatus } from '../../../domain/pet-medical-condition/pet-medical-condition';
import { healthPetMedicalConditions } from './health.schema';

@Injectable()
export class DrizzlePetMedicalConditionReader implements PetMedicalConditionReader {
  constructor(private readonly databaseService: DatabaseService) {}

  async findAccessibleByPet(
    request: PetMedicalConditionReadRequest,
  ): Promise<PetMedicalConditionListItem[] | null> {
    const rows = await this.databaseService.connection
      .select({
        condition: {
          id: healthPetMedicalConditions.id,
          name: healthPetMedicalConditions.name,
          status: healthPetMedicalConditions.status,
          diagnosedDate: healthPetMedicalConditions.diagnosedDate,
          notes: healthPetMedicalConditions.notes,
          recordedByAccountId: healthPetMedicalConditions.recordedByAccountId,
        },
      })
      .from(pets)
      .innerJoin(
        petMemberships,
        and(
          eq(petMemberships.petId, pets.id),
          eq(petMemberships.accountId, request.accountId),
          eq(petMemberships.status, 'ACTIVE'),
          inArray(petMemberships.role, ['OWNER', 'COLLABORATOR']),
        ),
      )
      .leftJoin(
        healthPetMedicalConditions,
        eq(healthPetMedicalConditions.petId, pets.id),
      )
      .where(
        and(
          eq(pets.id, request.petId),
          inArray(pets.status, ['ACTIVE', 'ARCHIVED']),
        ),
      )
      .orderBy(
        sql`${healthPetMedicalConditions.diagnosedDate} DESC NULLS LAST`,
        desc(healthPetMedicalConditions.createdAt),
        desc(healthPetMedicalConditions.id),
      );

    if (rows.length === 0) return null;
    return rows.flatMap((row): PetMedicalConditionListItem[] => {
      if (row.condition === null) return [];
      return [
        {
          id: row.condition.id,
          name: row.condition.name,
          status: row.condition.status as MedicalConditionStatus,
          diagnosedDate: row.condition.diagnosedDate,
          notes: row.condition.notes,
          recordedByAccountId: row.condition.recordedByAccountId,
        },
      ];
    });
  }
}
