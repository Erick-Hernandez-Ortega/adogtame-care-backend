import type { PetMedicalCondition } from '../../domain/pet-medical-condition/pet-medical-condition';

export const PET_MEDICAL_CONDITION_REPOSITORY: unique symbol = Symbol(
    'PET_MEDICAL_CONDITION_REPOSITORY',
);
export type CreatePetMedicalConditionOutcome = 'CREATED' | 'PET_NOT_FOUND';

export interface PetMedicalConditionCorrection {
    petId: string;
    conditionId: string;
    authenticatedAccountId: string;
    name?: string;
    diagnosedDate?: string | null;
    notes?: string | null;
    getToday: () => string;
}

export type UpdatePetMedicalConditionOutcome =
    | { status: 'UPDATED' | 'UNCHANGED'; condition: PetMedicalCondition }
    | { status: 'PET_NOT_FOUND' }
    | { status: 'PET_MEDICAL_CONDITION_NOT_FOUND' };

export interface PetMedicalConditionResolution {
    petId: string;
    conditionId: string;
    authenticatedAccountId: string;
    resolvedDate: string | null;
    getToday: () => string;
}

export type ResolvePetMedicalConditionOutcome =
    | { status: 'RESOLVED' | 'UNCHANGED'; condition: PetMedicalCondition }
    | { status: 'PET_NOT_FOUND' }
    | { status: 'PET_MEDICAL_CONDITION_NOT_FOUND' };

export interface PetMedicalConditionRepository {
    resolveIfPetWritable(
        resolution: PetMedicalConditionResolution,
    ): Promise<ResolvePetMedicalConditionOutcome>;
    correctIfPetWritable(
        correction: PetMedicalConditionCorrection,
    ): Promise<UpdatePetMedicalConditionOutcome>;
    createIfPetWritable(
        condition: PetMedicalCondition,
        authenticatedAccountId: string,
    ): Promise<CreatePetMedicalConditionOutcome>;
}
