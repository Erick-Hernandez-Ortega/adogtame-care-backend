import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import {
  petMemberships,
  pets,
} from '../../../../pet-management/infrastructure/persistence/drizzle/pet-management.schema';
import type {
  CreatePetAllergyOutcome,
  PetAllergyRepository,
} from '../../../application/persistence/pet-allergy.repository';
import type { PetAllergy } from '../../../domain/pet-allergy/pet-allergy';
import { healthPetAllergies } from './health.schema';

@Injectable()
export class DrizzlePetAllergyRepository implements PetAllergyRepository {
  constructor(private readonly databaseService: DatabaseService) {}
  async createIfPetWritable(
    allergy: PetAllergy,
    authenticatedAccountId: string,
  ): Promise<CreatePetAllergyOutcome> {
    return this.databaseService.connection.transaction(
      async (transaction): Promise<CreatePetAllergyOutcome> => {
        const petRows = await transaction
          .select({ status: pets.status })
          .from(pets)
          .where(eq(pets.id, allergy.petId.value))
          .for('update');
        if (petRows[0]?.status !== 'ACTIVE') return 'PET_NOT_FOUND';

        const membershipRows = await transaction
          .select({ role: petMemberships.role, status: petMemberships.status })
          .from(petMemberships)
          .where(
            and(
              eq(petMemberships.petId, allergy.petId.value),
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

        await transaction.insert(healthPetAllergies).values({
          id: allergy.id.value,
          petId: allergy.petId.value,
          allergen: allergy.allergen.value,
          category: allergy.category,
          severity: allergy.severity,
          notes: allergy.notes,
          recordedByAccountId: allergy.recordedByAccountId.value,
        });
        return 'CREATED';
      },
      { isolationLevel: 'read committed' },
    );
  }
}
