import type { PetAllergy } from '../../domain/pet-allergy/pet-allergy';

export const PET_ALLERGY_REPOSITORY: unique symbol = Symbol(
  'PET_ALLERGY_REPOSITORY',
);
export type CreatePetAllergyOutcome = 'CREATED' | 'PET_NOT_FOUND';

export interface PetAllergyCorrection {
  petId: string;
  allergyId: string;
  authenticatedAccountId: string;
  allergen?: string;
  category?: string;
  severity?: string;
  notes?: string | null;
}

export type UpdatePetAllergyOutcome =
  | { status: 'UPDATED' | 'UNCHANGED'; allergy: PetAllergy }
  | { status: 'PET_NOT_FOUND' }
  | { status: 'PET_ALLERGY_NOT_FOUND' };

export interface PetAllergyRepository {
  correctIfPetWritable(
    correction: PetAllergyCorrection,
  ): Promise<UpdatePetAllergyOutcome>;
  createIfPetWritable(
    allergy: PetAllergy,
    authenticatedAccountId: string,
  ): Promise<CreatePetAllergyOutcome>;
}
