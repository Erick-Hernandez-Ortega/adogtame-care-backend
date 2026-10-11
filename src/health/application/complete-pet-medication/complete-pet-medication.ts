import {
    InvalidMedicationEndedDateValueError,
    InvalidMedicationDiscontinuationReasonValueError,
    MedicationLifecycleConflictError,
    type PetMedication,
} from '../../domain/pet-medication/pet-medication';
import {
    PetMedicationNotFoundError,
    type PetMedicationRepository,
    type UpdatePetMedicationOutcome,
} from '../persistence/pet-medication.repository';
import type { Clock } from '../time/clock';
import {
    PetNotFoundError,
    type RecordedPetMedication,
} from '../record-pet-medication/record-pet-medication';

export interface CompletePetMedicationCommand {
    petId: string;
    medicationId: string;
    authenticatedAccountId: string;
    endedDate: string | null;
}

export class InvalidMedicationEndedDateError extends Error {
    constructor(cause: InvalidMedicationEndedDateValueError) {
        super(cause.message, { cause });
    }
}

export class InvalidMedicationDiscontinuationReasonError extends Error {
    constructor(cause: InvalidMedicationDiscontinuationReasonValueError) {
        super(cause.message, { cause });
    }
}

export class PetMedicationLifecycleConflictError extends Error {
    constructor(cause: MedicationLifecycleConflictError) {
        super(cause.message, { cause });
    }
}

export function mapMedicationLifecycleError(error: unknown): unknown {
    if (error instanceof InvalidMedicationEndedDateValueError) {
        return new InvalidMedicationEndedDateError(error);
    }

    if (error instanceof InvalidMedicationDiscontinuationReasonValueError) {
        return new InvalidMedicationDiscontinuationReasonError(error);
    }

    if (error instanceof MedicationLifecycleConflictError) {
        return new PetMedicationLifecycleConflictError(error);
    }

    return error;
}

export function projectMedicationOutcome(
    outcome: UpdatePetMedicationOutcome,
): RecordedPetMedication {
    if (outcome.status === 'PET_NOT_FOUND') {
        throw new PetNotFoundError();
    }

    if (outcome.status === 'PET_MEDICATION_NOT_FOUND') {
        throw new PetMedicationNotFoundError();
    }

    const medication: PetMedication = outcome.medication;

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
        status: medication.status,
        endedDate: medication.endedDate?.value ?? null,
        discontinuationReason: medication.discontinuationReason,
    };
}

export class CompletePetMedication {
    constructor(
        private readonly repository: PetMedicationRepository,
        private readonly clock: Clock,
    ) {}

    async execute(command: CompletePetMedicationCommand): Promise<RecordedPetMedication> {
        try {
            return projectMedicationOutcome(
                await this.repository.completeIfPetWritable({
                    ...command,
                    getToday: (): string => this.clock.now().toISOString().slice(0, 10),
                }),
            );
        } catch (error: unknown) {
            throw mapMedicationLifecycleError(error);
        }
    }
}
