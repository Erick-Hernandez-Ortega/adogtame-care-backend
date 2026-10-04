import type { PetAllergy } from '../../domain/pet-allergy/pet-allergy';

export const PET_ALLERGY_REPOSITORY: unique symbol = Symbol(
  'PET_ALLERGY_REPOSITORY',
);
export type CreatePetAllergyOutcome = 'CREATED' | 'PET_NOT_FOUND';

export interface PetAllergyRepository {
  createIfPetWritable(
    allergy: PetAllergy,
    authenticatedAccountId: string,
  ): Promise<CreatePetAllergyOutcome>;
}
