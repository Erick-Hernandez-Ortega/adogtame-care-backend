import type { PetMedication } from '../../domain/pet-medication/pet-medication';

export const PET_MEDICATION_REPOSITORY: unique symbol = Symbol('PET_MEDICATION_REPOSITORY');

export interface PetMedicationRecording {
    petId: string;
    authenticatedAccountId: string;
    name: string;
    dosage?: string | null;
    frequency?: string | null;
    startDate?: string | null;
    plannedEndDate?: string | null;
    notes?: string | null;
}

export type CreatePetMedicationOutcome =
    { status: 'CREATED'; medication: PetMedication } | { status: 'PET_NOT_FOUND' };

export interface PetMedicationRepository {
    createIfPetWritable(recording: PetMedicationRecording): Promise<CreatePetMedicationOutcome>;
}
