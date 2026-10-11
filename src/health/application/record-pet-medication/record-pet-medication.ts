import type { MedicationStatus } from '../../domain/pet-medication/pet-medication';
import {
    InvalidMedicationNameValueError,
    InvalidMedicationDosageValueError,
    InvalidMedicationFrequencyValueError,
    InvalidMedicationStartDateValueError,
    InvalidMedicationPlannedEndDateValueError,
    InvalidMedicationNotesValueError,
} from '../../domain/pet-medication/pet-medication';
import type { PetMedicationRepository } from '../persistence/pet-medication.repository';

export interface RecordPetMedicationCommand {
    petId: string;
    authenticatedAccountId: string;
    name: string;
    dosage?: string | null;
    frequency?: string | null;
    startDate?: string | null;
    plannedEndDate?: string | null;
    notes?: string | null;
}

export interface RecordedPetMedication {
    id: string;
    petId: string;
    name: string;
    dosage: string | null;
    frequency: string | null;
    startDate: string | null;
    plannedEndDate: string | null;
    notes: string | null;
    recordedByAccountId: string;
    status: MedicationStatus;
    endedDate: string | null;
    discontinuationReason: string | null;
}

export class InvalidMedicationNameError extends Error {
    constructor(cause: InvalidMedicationNameValueError) {
        super(cause.message, { cause });
    }
}

export class InvalidMedicationDosageError extends Error {
    constructor(cause: InvalidMedicationDosageValueError) {
        super(cause.message, { cause });
    }
}

export class InvalidMedicationFrequencyError extends Error {
    constructor(cause: InvalidMedicationFrequencyValueError) {
        super(cause.message, { cause });
    }
}

export class InvalidMedicationStartDateError extends Error {
    constructor(cause: InvalidMedicationStartDateValueError) {
        super(cause.message, { cause });
    }
}

export class InvalidMedicationPlannedEndDateError extends Error {
    constructor(cause: InvalidMedicationPlannedEndDateValueError) {
        super(cause.message, { cause });
    }
}

export class InvalidMedicationNotesError extends Error {
    constructor(cause: InvalidMedicationNotesValueError) {
        super(cause.message, { cause });
    }
}

export class PetNotFoundError extends Error {
    constructor() {
        super('Pet was not found');
    }
}

export class RecordPetMedication {
    constructor(private readonly repository: PetMedicationRepository) {}

    async execute(command: RecordPetMedicationCommand): Promise<RecordedPetMedication> {
        try {
            const outcome = await this.repository.createIfPetWritable({ ...command });

            if (outcome.status === 'PET_NOT_FOUND') {
                throw new PetNotFoundError();
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
                status: medication.status,
                endedDate: medication.endedDate?.value ?? null,
                discontinuationReason: medication.discontinuationReason,
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
