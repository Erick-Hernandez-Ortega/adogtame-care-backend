import type { MedicationStatus } from '../../domain/pet-medication/pet-medication';
export const PET_MEDICATION_READER: unique symbol = Symbol('PET_MEDICATION_READER');

export interface ListedPetMedication {
    readonly status: MedicationStatus;
    readonly endedDate: string | null;
    readonly discontinuationReason: string | null;
    readonly id: string;
    readonly name: string;
    readonly dosage: string | null;
    readonly frequency: string | null;
    readonly startDate: string | null;
    readonly plannedEndDate: string | null;
    readonly notes: string | null;
    readonly recordedByAccountId: string;
}

export interface PetMedicationReadRequest {
    readonly petId: string;
    readonly authenticatedAccountId: string;
}

export interface PetMedicationReader {
    listIfPetReadable(request: PetMedicationReadRequest): Promise<ListedPetMedication[] | null>;
}
