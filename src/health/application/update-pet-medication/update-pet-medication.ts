import {
    InvalidMedicationNameValueError,
    InvalidMedicationDosageValueError,
    InvalidMedicationFrequencyValueError,
    InvalidMedicationStartDateValueError,
    InvalidMedicationPlannedEndDateValueError,
    InvalidMedicationNotesValueError,
} from '../../domain/pet-medication/pet-medication';
import type { PetMedicationRepository } from '../persistence/pet-medication.repository';
import {
    PetNotFoundError,
    InvalidMedicationNameError,
    InvalidMedicationDosageError,
    InvalidMedicationFrequencyError,
    InvalidMedicationStartDateError,
    InvalidMedicationPlannedEndDateError,
    InvalidMedicationNotesError,
    type RecordedPetMedication as UpdatedPetMedication,
} from '../record-pet-medication/record-pet-medication';

export interface UpdatePetMedicationCommand {
    petId: string;
    medicationId: string;
    authenticatedAccountId: string;
    name?: string;
    dosage?: string | null;
    frequency?: string | null;
    startDate?: string | null;
    plannedEndDate?: string | null;
    notes?: string | null;
}
export type { UpdatedPetMedication };

export class PetMedicationNotFoundError extends Error {
    constructor() {
        super('Pet medication was not found');
    }
}

export class UpdatePetMedication {
    constructor(private readonly repository: PetMedicationRepository) {}

    async execute(command: UpdatePetMedicationCommand): Promise<UpdatedPetMedication> {
        try {
            const outcome = await this.repository.correctIfPetWritable({ ...command });

            if (outcome.status === 'PET_NOT_FOUND') {
                throw new PetNotFoundError();
            }

            if (outcome.status === 'PET_MEDICATION_NOT_FOUND') {
                throw new PetMedicationNotFoundError();
            }

            const medication = outcome.medication;

            return {
                id: medication.id.value,
                petId: medication.petId.value,
                name: medication.name.value,
                dosage: medication.dosage,
                frequency: medication.frequency,
                startDate: medication.startDate?.value ?? null,
                plannedEndDate: medication.plannedEndDate?.value ?? null,
                notes: medication.notes,
                recordedByAccountId: medication.recordedByAccountId.value,
            };
        } catch (error: unknown) {
            if (error instanceof InvalidMedicationNameValueError) {
                throw new InvalidMedicationNameError(error);
            }

            if (error instanceof InvalidMedicationDosageValueError) {
                throw new InvalidMedicationDosageError(error);
            }

            if (error instanceof InvalidMedicationFrequencyValueError) {
                throw new InvalidMedicationFrequencyError(error);
            }

            if (error instanceof InvalidMedicationStartDateValueError) {
                throw new InvalidMedicationStartDateError(error);
            }

            if (error instanceof InvalidMedicationPlannedEndDateValueError) {
                throw new InvalidMedicationPlannedEndDateError(error);
            }

            if (error instanceof InvalidMedicationNotesValueError) {
                throw new InvalidMedicationNotesError(error);
            }

            throw error;
        }
    }
}
