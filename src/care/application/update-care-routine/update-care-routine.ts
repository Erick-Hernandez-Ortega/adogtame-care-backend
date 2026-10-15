import {
    InvalidRoutineTypeValueError,
    InvalidRoutineTitleValueError,
    InvalidRoutineInstructionsValueError,
    InvalidRoutineFrequencyValueError,
    InvalidRoutineTimezoneValueError,
} from '../../domain/care-routine/care-routine';
import type {
    CareRoutineCorrection,
    CareRoutineRepository,
} from '../persistence/care-routine.repository';
import {
    type CreatedCareRoutine,
    PetNotFoundError,
    InvalidRoutineTypeError,
    InvalidRoutineTitleError,
    InvalidRoutineInstructionsError,
    InvalidRoutineFrequencyError,
    InvalidRoutineTimezoneError,
} from '../create-care-routine/create-care-routine';

export type UpdateCareRoutineCommand = CareRoutineCorrection;
export type UpdatedCareRoutine = CreatedCareRoutine;

export class CareRoutineNotFoundError extends Error {
    constructor() {
        super('Care routine was not found');
    }
}

export class UpdateCareRoutine {
    constructor(private readonly repository: CareRoutineRepository) {}

    async execute(command: UpdateCareRoutineCommand): Promise<UpdatedCareRoutine> {
        try {
            const outcome = await this.repository.correctIfPetWritable(command);

            if (outcome.status === 'PET_NOT_FOUND') {
                throw new PetNotFoundError();
            }

            if (outcome.status === 'CARE_ROUTINE_NOT_FOUND') {
                throw new CareRoutineNotFoundError();
            }

            const routine = outcome.routine;

            return {
                id: routine.id.value,
                petId: routine.petId.value,
                type: routine.type.value,
                title: routine.title.value,
                instructions: routine.instructions?.value ?? null,
                frequency: {
                    period: routine.frequency.period,
                    timesPerPeriod: routine.frequency.timesPerPeriod,
                    suggestedTimes: routine.frequency.suggestedTimes,
                    weekdays: routine.frequency.weekdays,
                },
                timezone: routine.timezone.value,
                recordedByAccountId: routine.recordedByAccountId.value,
            };
        } catch (error: unknown) {
            if (error instanceof InvalidRoutineTypeValueError) {
                throw new InvalidRoutineTypeError(error);
            }

            if (error instanceof InvalidRoutineTitleValueError) {
                throw new InvalidRoutineTitleError(error);
            }

            if (error instanceof InvalidRoutineInstructionsValueError) {
                throw new InvalidRoutineInstructionsError(error);
            }

            if (error instanceof InvalidRoutineFrequencyValueError) {
                throw new InvalidRoutineFrequencyError(error);
            }

            if (error instanceof InvalidRoutineTimezoneValueError) {
                throw new InvalidRoutineTimezoneError(error);
            }

            throw error;
        }
    }
}
