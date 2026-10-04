import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import {
  petMemberships,
  pets,
} from '../../../../pet-management/infrastructure/persistence/drizzle/pet-management.schema';
import type {
  CreatePetMedicalConditionOutcome,
  PetMedicalConditionRepository,
} from '../../../application/persistence/pet-medical-condition.repository';
import type { PetMedicalCondition } from '../../../domain/pet-medical-condition/pet-medical-condition';
import { healthPetMedicalConditions } from './health.schema';

@Injectable()
export class DrizzlePetMedicalConditionRepository implements PetMedicalConditionRepository {
  constructor(private readonly databaseService: DatabaseService) {}
  async createIfPetWritable(
    condition: PetMedicalCondition,
    authenticatedAccountId: string,
  ): Promise<CreatePetMedicalConditionOutcome> {
    return this.databaseService.connection.transaction(
      async (transaction): Promise<CreatePetMedicalConditionOutcome> => {
        const petRows = await transaction
          .select({ status: pets.status })
          .from(pets)
          .where(eq(pets.id, condition.petId.value))
          .for('update');
        if (petRows[0]?.status !== 'ACTIVE') return 'PET_NOT_FOUND';

        const membershipRows = await transaction
          .select({ role: petMemberships.role, status: petMemberships.status })
          .from(petMemberships)
          .where(
            and(
              eq(petMemberships.petId, condition.petId.value),
              eq(petMemberships.accountId, authenticatedAccountId),
            ),
          )
          .for('update');
        const membership = membershipRows[0];
        if (
          membership?.status !== 'ACTIVE' ||
          (membership.role !== 'OWNER' && membership.role !== 'COLLABORATOR')
        ) {
          return 'PET_NOT_FOUND';
        }

        await transaction.insert(healthPetMedicalConditions).values({
          id: condition.id.value,
          petId: condition.petId.value,
          name: condition.name.value,
          status: condition.status,
          diagnosedDate: condition.diagnosedDate?.value ?? null,
          notes: condition.notes,
          recordedByAccountId: condition.recordedByAccountId.value,
        });
        return 'CREATED';
      },
      { isolationLevel: 'read committed' },
    );
  }
}
