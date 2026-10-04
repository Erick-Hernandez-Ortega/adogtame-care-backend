import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import {
  petMemberships,
  pets,
} from '../../../../pet-management/infrastructure/persistence/drizzle/pet-management.schema';
import type {
  CreatePetAllergyOutcome,
  PetAllergyCorrection,
  UpdatePetAllergyOutcome,
  PetAllergyRepository,
} from '../../../application/persistence/pet-allergy.repository';
import {
  PetAllergy,
  PetAllergyId,
  PetId,
  RecordedByAccountId,
} from '../../../domain/pet-allergy/pet-allergy';
import { Allergen } from '../../../domain/allergen/allergen';
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

  async correctIfPetWritable(
    correction: PetAllergyCorrection,
  ): Promise<UpdatePetAllergyOutcome> {
    return this.databaseService.connection.transaction(
      async (transaction): Promise<UpdatePetAllergyOutcome> => {
        const petRows = await transaction
          .select({ status: pets.status })
          .from(pets)
          .where(eq(pets.id, correction.petId))
          .for('update');
        if (petRows[0]?.status !== 'ACTIVE') return { status: 'PET_NOT_FOUND' };
        const membershipRows = await transaction
          .select({ role: petMemberships.role, status: petMemberships.status })
          .from(petMemberships)
          .where(
            and(
              eq(petMemberships.petId, correction.petId),
              eq(petMemberships.accountId, correction.authenticatedAccountId),
            ),
          )
          .for('update');
        const membership = membershipRows[0];
        if (
          membership?.status !== 'ACTIVE' ||
          (membership.role !== 'OWNER' && membership.role !== 'COLLABORATOR')
        )
          return { status: 'PET_NOT_FOUND' };
        const allergyRows = await transaction
          .select()
          .from(healthPetAllergies)
          .where(
            and(
              eq(healthPetAllergies.id, correction.allergyId),
              eq(healthPetAllergies.petId, correction.petId),
            ),
          )
          .for('update');
        const row = allergyRows[0];
        if (row === undefined) return { status: 'PET_ALLERGY_NOT_FOUND' };
        const allergy: PetAllergy = PetAllergy.reconstitute({
          id: PetAllergyId.from(row.id),
          petId: PetId.from(row.petId),
          allergen: Allergen.from(row.allergen),
          category: row.category,
          severity: row.severity,
          notes: row.notes,
          recordedByAccountId: RecordedByAccountId.from(
            row.recordedByAccountId,
          ),
        });
        const corrected: PetAllergy = allergy.correct(correction);
        if (corrected === allergy) return { status: 'UNCHANGED', allergy };
        await transaction
          .update(healthPetAllergies)
          .set({
            allergen: corrected.allergen.value,
            category: corrected.category,
            severity: corrected.severity,
            notes: corrected.notes,
          })
          .where(
            and(
              eq(healthPetAllergies.id, correction.allergyId),
              eq(healthPetAllergies.petId, correction.petId),
            ),
          );
        return { status: 'UPDATED', allergy: corrected };
      },
      { isolationLevel: 'read committed' },
    );
  }
}
