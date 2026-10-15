import { generateUuid, normalizeUuid } from '../../../shared/domain/uuid';
import {
    type RoutineFrequencyInput,
    RoutineFrequency,
} from '../routine-frequency/routine-frequency';
import { RoutineInstructions } from '../routine-instructions/routine-instructions';
import { RoutineTimezone } from '../routine-timezone/routine-timezone';
import { RoutineTitle } from '../routine-title/routine-title';
import { CareRoutineType } from '../routine-type/routine-type';

export class CareRoutineId {
    private constructor(readonly value: string) {}

    static from(value: string): CareRoutineId {
        return new CareRoutineId(normalizeUuid(value, 'Care routine ID'));
    }

    static generate(): CareRoutineId {
        return new CareRoutineId(generateUuid());
    }
}

export class PetId {
    private constructor(readonly value: string) {}

    static from(value: string): PetId {
        return new PetId(normalizeUuid(value, 'Pet ID'));
    }
}

export class RecordedByAccountId {
    private constructor(readonly value: string) {}

    static from(value: string): RecordedByAccountId {
        return new RecordedByAccountId(normalizeUuid(value, 'Account ID'));
    }
}

interface CreateCareRoutineInput {
    petId: PetId;
    type: CareRoutineType;
    title: RoutineTitle;
    instructions?: RoutineInstructions | null;
    frequency: RoutineFrequency;
    timezone: RoutineTimezone;
    recordedByAccountId: RecordedByAccountId;
}

interface ReconstituteCareRoutineInput extends CreateCareRoutineInput {
    id: CareRoutineId;
}

export interface CorrectCareRoutineInput {
    type?: string;
    title?: string;
    instructions?: string | null;
    frequency?: RoutineFrequencyInput;
    timezone?: string;
}

export class InvalidRoutineTypeValueError extends TypeError {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}

export class InvalidRoutineTitleValueError extends TypeError {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}

export class InvalidRoutineInstructionsValueError extends TypeError {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}

export class InvalidRoutineFrequencyValueError extends TypeError {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}

export class InvalidRoutineTimezoneValueError extends TypeError {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}

export class CareRoutine {
    private constructor(
        readonly id: CareRoutineId,
        readonly petId: PetId,
        readonly type: CareRoutineType,
        readonly title: RoutineTitle,
        readonly instructions: RoutineInstructions | null,
        readonly frequency: RoutineFrequency,
        readonly timezone: RoutineTimezone,
        readonly recordedByAccountId: RecordedByAccountId,
    ) {}

    static create(input: CreateCareRoutineInput): CareRoutine {
        return CareRoutine.reconstitute({ ...input, id: CareRoutineId.generate() });
    }

    static reconstitute(input: ReconstituteCareRoutineInput): CareRoutine {
        if (
            !(input.id instanceof CareRoutineId) ||
            !(input.petId instanceof PetId) ||
            !(input.type instanceof CareRoutineType) ||
            !(input.title instanceof RoutineTitle) ||
            !(input.frequency instanceof RoutineFrequency) ||
            !(input.timezone instanceof RoutineTimezone) ||
            !(input.recordedByAccountId instanceof RecordedByAccountId) ||
            (input.instructions !== undefined &&
                input.instructions !== null &&
                !(input.instructions instanceof RoutineInstructions))
        ) {
            throw new TypeError('Care routine data is invalid');
        }

        return new CareRoutine(
            input.id,
            input.petId,
            input.type,
            input.title,
            input.instructions ?? null,
            input.frequency,
            input.timezone,
            input.recordedByAccountId,
        );
    }

    correct(input: CorrectCareRoutineInput): CareRoutine {
        if (
            input.type === undefined &&
            input.title === undefined &&
            input.instructions === undefined &&
            input.frequency === undefined &&
            input.timezone === undefined
        ) {
            throw new TypeError('Care routine correction is invalid');
        }

        let type: CareRoutineType = this.type;

        if (input.type !== undefined) {
            try {
                type = CareRoutineType.from(input.type);
            } catch (error: unknown) {
                if (error instanceof TypeError || error instanceof RangeError) {
                    throw new InvalidRoutineTypeValueError(error);
                }

                throw error;
            }
        }

        let title: RoutineTitle = this.title;

        if (input.title !== undefined) {
            try {
                title = RoutineTitle.from(input.title);
            } catch (error: unknown) {
                if (error instanceof TypeError || error instanceof RangeError) {
                    throw new InvalidRoutineTitleValueError(error);
                }

                throw error;
            }
        }

        let instructions: RoutineInstructions | null = this.instructions;

        if (input.instructions !== undefined) {
            try {
                instructions =
                    input.instructions === null
                        ? null
                        : RoutineInstructions.from(input.instructions);
            } catch (error: unknown) {
                if (error instanceof TypeError || error instanceof RangeError) {
                    throw new InvalidRoutineInstructionsValueError(error);
                }

                throw error;
            }
        }

        let frequency: RoutineFrequency = this.frequency;

        if (input.frequency !== undefined) {
            try {
                frequency = RoutineFrequency.from(input.frequency);
            } catch (error: unknown) {
                if (error instanceof TypeError || error instanceof RangeError) {
                    throw new InvalidRoutineFrequencyValueError(error);
                }

                throw error;
            }
        }

        let timezone: RoutineTimezone = this.timezone;

        if (input.timezone !== undefined) {
            try {
                timezone = RoutineTimezone.from(input.timezone);
            } catch (error: unknown) {
                if (error instanceof TypeError || error instanceof RangeError) {
                    throw new InvalidRoutineTimezoneValueError(error);
                }

                throw error;
            }
        }

        const candidate: CareRoutine = CareRoutine.reconstitute({
            ...this,
            type,
            title,
            instructions,
            frequency,
            timezone,
        });

        if (
            candidate.type.value === this.type.value &&
            candidate.title.value === this.title.value &&
            candidate.instructions?.value === this.instructions?.value &&
            candidate.timezone.value === this.timezone.value &&
            candidate.frequency.period === this.frequency.period &&
            candidate.frequency.timesPerPeriod === this.frequency.timesPerPeriod &&
            JSON.stringify(candidate.frequency.suggestedTimes) ===
                JSON.stringify(this.frequency.suggestedTimes) &&
            JSON.stringify(candidate.frequency.weekdays) === JSON.stringify(this.frequency.weekdays)
        ) {
            return this;
        }

        return candidate;
    }

    changeTimezone(timezone: RoutineTimezone): CareRoutine {
        if (!(timezone instanceof RoutineTimezone)) {
            throw new TypeError('Routine timezone is invalid');
        }

        if (timezone.value === this.timezone.value) {
            return this;
        }

        return CareRoutine.reconstitute({ ...this, timezone });
    }
}
