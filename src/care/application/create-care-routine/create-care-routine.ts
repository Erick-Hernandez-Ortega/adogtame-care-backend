import { CareRoutine, PetId, RecordedByAccountId } from '../../domain/care-routine/care-routine';
import { CareRoutineType, type RoutineType } from '../../domain/routine-type/routine-type';
import { RoutineTitle } from '../../domain/routine-title/routine-title';
import { RoutineInstructions } from '../../domain/routine-instructions/routine-instructions';
import { RoutineTimezone } from '../../domain/routine-timezone/routine-timezone';
import {
    RoutineFrequency,
    type RoutineFrequencyInput,
    type FrequencyPeriod,
    type Weekday,
} from '../../domain/routine-frequency/routine-frequency';
import type {
    CareRoutineRepository,
    CreateCareRoutineOutcome,
} from '../persistence/care-routine.repository';

export interface CreateCareRoutineCommand {
    petId: string;
    authenticatedAccountId: string;
    type: string;
    title: string;
    instructions?: string | null;
    frequency: RoutineFrequencyInput;
    timezone: string;
}

export interface CreatedCareRoutine {
    id: string;
    petId: string;
    type: RoutineType;
    title: string;
    instructions: string | null;
    frequency: {
        period: FrequencyPeriod;
        timesPerPeriod: number;
        suggestedTimes: readonly string[];
        weekdays: readonly Weekday[];
    };
    timezone: string;
    recordedByAccountId: string;
}

export class InvalidRoutineTypeError extends Error {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}

export class InvalidRoutineTitleError extends Error {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}

export class InvalidRoutineInstructionsError extends Error {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}

export class InvalidRoutineFrequencyError extends Error {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}

export class InvalidRoutineTimezoneError extends Error {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}

export class PetNotFoundError extends Error {
    constructor() {
        super('Pet was not found');
    }
}

export class CreateCareRoutine {
    constructor(private readonly repository: CareRoutineRepository) {}

    async execute(command: CreateCareRoutineCommand): Promise<CreatedCareRoutine> {
        let type: CareRoutineType;

        try {
            type = CareRoutineType.from(command.type);
        } catch (error: unknown) {
            if (error instanceof TypeError || error instanceof RangeError) {
                throw new InvalidRoutineTypeError(error);
            }

            throw error;
        }

        let title: RoutineTitle;

        try {
            title = RoutineTitle.from(command.title);
        } catch (error: unknown) {
            if (error instanceof TypeError || error instanceof RangeError) {
                throw new InvalidRoutineTitleError(error);
            }

            throw error;
        }

        let instructions: RoutineInstructions | null;

        try {
            instructions =
                command.instructions == null
                    ? null
                    : RoutineInstructions.from(command.instructions);
        } catch (error: unknown) {
            if (error instanceof TypeError || error instanceof RangeError) {
                throw new InvalidRoutineInstructionsError(error);
            }

            throw error;
        }

        let frequency: RoutineFrequency;

        try {
            frequency = RoutineFrequency.from(command.frequency);
        } catch (error: unknown) {
            if (error instanceof TypeError || error instanceof RangeError) {
                throw new InvalidRoutineFrequencyError(error);
            }

            throw error;
        }

        let timezone: RoutineTimezone;

        try {
            timezone = RoutineTimezone.from(command.timezone);
        } catch (error: unknown) {
            if (error instanceof TypeError || error instanceof RangeError) {
                throw new InvalidRoutineTimezoneError(error);
            }

            throw error;
        }

        const routine: CareRoutine = CareRoutine.create({
            petId: PetId.from(command.petId),
            type,
            title,
            instructions,
            frequency,
            timezone,
            recordedByAccountId: RecordedByAccountId.from(command.authenticatedAccountId),
        });
        const outcome: CreateCareRoutineOutcome = await this.repository.createIfPetWritable(
            routine,
            command.authenticatedAccountId,
        );

        if (outcome === 'PET_NOT_FOUND') {
            throw new PetNotFoundError();
        }

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
    }
}
