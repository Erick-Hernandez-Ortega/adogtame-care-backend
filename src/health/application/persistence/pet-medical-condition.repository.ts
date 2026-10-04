import type { PetMedicalCondition } from '../../domain/pet-medical-condition/pet-medical-condition';

export const PET_MEDICAL_CONDITION_REPOSITORY: unique symbol = Symbol(
  'PET_MEDICAL_CONDITION_REPOSITORY',
);
export type CreatePetMedicalConditionOutcome = 'CREATED' | 'PET_NOT_FOUND';

export interface PetMedicalConditionRepository {
  createIfPetWritable(
    condition: PetMedicalCondition,
    authenticatedAccountId: string,
  ): Promise<CreatePetMedicalConditionOutcome>;
}
