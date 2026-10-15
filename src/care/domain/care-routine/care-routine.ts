import { generateUuid, normalizeUuid } from '../../../shared/domain/uuid';
import { RoutineFrequency } from '../routine-frequency/routine-frequency';
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
