import { ResolvedDate } from '../resolved-date/resolved-date';
import { randomUUID } from 'node:crypto';
import { DiagnosedDate } from '../diagnosed-date/diagnosed-date';
import { MedicalConditionName } from '../medical-condition-name/medical-condition-name';

const UUID_PATTERN: RegExp =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID: string = '00000000-0000-0000-0000-000000000000';

function validId(value: string, label: string): string {
    const normalizedValue: string = value.toLowerCase();

    if (!UUID_PATTERN.test(normalizedValue) || normalizedValue === NIL_UUID) {
        throw new TypeError(`${label} must be a valid non-nil UUID`);
    }

    return normalizedValue;
}

export class PetMedicalConditionId {
    private constructor(readonly value: string) {}

    static from(value: string): PetMedicalConditionId {
        return new PetMedicalConditionId(validId(value, 'Pet medical condition ID'));
    }

    static generate(): PetMedicalConditionId {
        return new PetMedicalConditionId(randomUUID());
    }
}

export class PetId {
    private constructor(readonly value: string) {}

    static from(value: string): PetId {
        return new PetId(validId(value, 'Pet ID'));
    }
}

export class RecordedByAccountId {
    private constructor(readonly value: string) {}

    static from(value: string): RecordedByAccountId {
        return new RecordedByAccountId(validId(value, 'Account ID'));
    }
}

export const MedicalConditionStatus = {
    ACTIVE: 'ACTIVE',
    RESOLVED: 'RESOLVED',
} as const;
export type MedicalConditionStatus =
    (typeof MedicalConditionStatus)[keyof typeof MedicalConditionStatus];

export class InvalidMedicalConditionNotesValueError extends TypeError {
    constructor(message: string) {
        super(message);
    }
}

interface CreatePetMedicalConditionInput {
    petId: PetId;
    name: MedicalConditionName;
    diagnosedDate?: DiagnosedDate | null;
    notes?: string | null;
    recordedByAccountId: RecordedByAccountId;
}

interface ReconstitutePetMedicalConditionInput extends CreatePetMedicalConditionInput {
    id: PetMedicalConditionId;
    status: string;
    resolvedDate?: ResolvedDate | null;
}

interface CorrectPetMedicalConditionInput {
    name?: string;
    diagnosedDate?: string | null;
    notes?: string | null;
}

export class InvalidMedicalConditionNameValueError extends TypeError {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}

export class InvalidMedicalConditionDiagnosedDateValueError extends TypeError {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}

export class InvalidMedicalConditionResolvedDateValueError extends TypeError {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}

interface ResolvePetMedicalConditionInput {
    resolvedDate: string | null;
}

export class PetMedicalCondition {
    private constructor(
        readonly id: PetMedicalConditionId,
        readonly petId: PetId,
        readonly name: MedicalConditionName,
        readonly diagnosedDate: DiagnosedDate | null,
        readonly notes: string | null,
        readonly recordedByAccountId: RecordedByAccountId,
        readonly status: MedicalConditionStatus,
        readonly resolvedDate: ResolvedDate | null,
    ) {}

    static create(input: CreatePetMedicalConditionInput): PetMedicalCondition {
        return PetMedicalCondition.reconstitute({
            ...input,
            id: PetMedicalConditionId.generate(),
            status: MedicalConditionStatus.ACTIVE,
            resolvedDate: null,
        });
    }

    static reconstitute(input: ReconstitutePetMedicalConditionInput): PetMedicalCondition {
        if (
            !(input.id instanceof PetMedicalConditionId) ||
            !(input.petId instanceof PetId) ||
            !(input.name instanceof MedicalConditionName) ||
            !(input.recordedByAccountId instanceof RecordedByAccountId) ||
            (input.diagnosedDate !== undefined &&
                input.diagnosedDate !== null &&
                !(input.diagnosedDate instanceof DiagnosedDate))
        ) {
            throw new TypeError('Pet medical condition data is invalid');
        }

        if (
            input.status !== MedicalConditionStatus.ACTIVE &&
            input.status !== MedicalConditionStatus.RESOLVED
        ) {
            throw new TypeError('Medical condition status must be ACTIVE or RESOLVED');
        }

        if (
            input.resolvedDate !== undefined &&
            input.resolvedDate !== null &&
            !(input.resolvedDate instanceof ResolvedDate)
        ) {
            throw new TypeError('Resolved date data is invalid');
        }

        if (input.status === MedicalConditionStatus.ACTIVE && input.resolvedDate != null) {
            throw new TypeError('Active medical conditions cannot have a resolved date');
        }

        const notes: string | null = PetMedicalCondition.normalizeNotes(input.notes);

        return new PetMedicalCondition(
            input.id,
            input.petId,
            input.name,
            input.diagnosedDate ?? null,
            notes,
            input.recordedByAccountId,
            input.status,
            input.resolvedDate ?? null,
        );
    }

    correct(input: CorrectPetMedicalConditionInput, today: string): PetMedicalCondition {
        if (
            input.name === undefined &&
            input.diagnosedDate === undefined &&
            input.notes === undefined
        ) {
            throw new TypeError('Pet medical condition correction is invalid');
        }

        let name: MedicalConditionName = this.name;

        if (input.name !== undefined) {
            try {
                name = MedicalConditionName.from(input.name);
            } catch (error: unknown) {
                if (error instanceof TypeError || error instanceof RangeError) {
                    throw new InvalidMedicalConditionNameValueError(error);
                }

                throw error;
            }
        }

        let diagnosedDate: DiagnosedDate | null = this.diagnosedDate;

        if (input.diagnosedDate !== undefined) {
            try {
                diagnosedDate =
                    input.diagnosedDate === null
                        ? null
                        : DiagnosedDate.from(input.diagnosedDate, today);
            } catch (error: unknown) {
                if (error instanceof TypeError || error instanceof RangeError) {
                    throw new InvalidMedicalConditionDiagnosedDateValueError(error);
                }

                throw error;
            }
        }

        const candidate: PetMedicalCondition = PetMedicalCondition.reconstitute({
            id: this.id,
            petId: this.petId,
            name,
            diagnosedDate,
            notes: input.notes === undefined ? this.notes : input.notes,
            recordedByAccountId: this.recordedByAccountId,
            status: this.status,
            resolvedDate: this.resolvedDate,
        });

        if (
            candidate.name.value === this.name.value &&
            candidate.diagnosedDate?.value === this.diagnosedDate?.value &&
            candidate.notes === this.notes
        ) {
            return this;
        }

        return candidate;
    }

    resolve(input: ResolvePetMedicalConditionInput, today: string): PetMedicalCondition {
        if (this.status === MedicalConditionStatus.RESOLVED) {
            return this;
        }

        let resolvedDate: ResolvedDate | null;

        try {
            resolvedDate =
                input.resolvedDate === null ? null : ResolvedDate.from(input.resolvedDate, today);
        } catch (error: unknown) {
            if (error instanceof TypeError || error instanceof RangeError) {
                throw new InvalidMedicalConditionResolvedDateValueError(error);
            }

            throw error;
        }

        return PetMedicalCondition.reconstitute({
            id: this.id,
            petId: this.petId,
            name: this.name,
            diagnosedDate: this.diagnosedDate,
            notes: this.notes,
            recordedByAccountId: this.recordedByAccountId,
            status: MedicalConditionStatus.RESOLVED,
            resolvedDate,
        });
    }

    reopen(): PetMedicalCondition {
        if (this.status === MedicalConditionStatus.ACTIVE) {
            return this;
        }

        return PetMedicalCondition.reconstitute({
            id: this.id,
            petId: this.petId,
            name: this.name,
            diagnosedDate: this.diagnosedDate,
            notes: this.notes,
            recordedByAccountId: this.recordedByAccountId,
            status: MedicalConditionStatus.ACTIVE,
            resolvedDate: null,
        });
    }

    private static normalizeNotes(value: string | null | undefined): string | null {
        if (value === undefined || value === null) {
            return null;
        }

        if (typeof value !== 'string') {
            throw new InvalidMedicalConditionNotesValueError(
                'Medical condition notes must be a string',
            );
        }

        const normalizedValue: string = value.trim();

        if (normalizedValue.length === 0) {
            throw new InvalidMedicalConditionNotesValueError(
                'Medical condition notes cannot be empty',
            );
        }

        if (Array.from(normalizedValue).length > 2000) {
            throw new InvalidMedicalConditionNotesValueError(
                'Medical condition notes must have at most 2000 characters',
            );
        }

        return normalizedValue;
    }
}
