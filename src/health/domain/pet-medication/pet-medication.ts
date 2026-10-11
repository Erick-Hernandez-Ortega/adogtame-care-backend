import { randomUUID } from 'node:crypto';
import { MedicationName } from '../medication-name/medication-name';
import { MedicationDate } from '../medication-date/medication-date';

const UUID_PATTERN: RegExp =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID: string = '00000000-0000-0000-0000-000000000000';

function validId(value: string, label: string): string {
    const normalizedValue: string = value.toLowerCase();

    if (
        normalizedValue.length !== 36 ||
        !UUID_PATTERN.test(normalizedValue) ||
        normalizedValue === NIL_UUID
    ) {
        throw new TypeError(`${label} must be a valid non-nil UUID`);
    }

    return normalizedValue;
}

export class PetMedicationId {
    private constructor(readonly value: string) {}

    static from(value: string): PetMedicationId {
        return new PetMedicationId(validId(value, 'Pet medication ID'));
    }

    static generate(this: void): PetMedicationId {
        return new PetMedicationId(randomUUID());
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

export class InvalidMedicationNameValueError extends TypeError {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}

export class InvalidMedicationDosageValueError extends TypeError {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}

export class InvalidMedicationFrequencyValueError extends TypeError {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}

export class InvalidMedicationStartDateValueError extends TypeError {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}

export class InvalidMedicationPlannedEndDateValueError extends TypeError {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}

export class InvalidMedicationNotesValueError extends TypeError {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}

interface CreatePetMedicationInput {
    petId: PetId;
    recordedByAccountId: RecordedByAccountId;
    name: string;
    dosage?: string | null;
    frequency?: string | null;
    startDate?: string | null;
    plannedEndDate?: string | null;
    notes?: string | null;
}

export class PetMedication {
    private constructor(
        readonly id: PetMedicationId,
        readonly petId: PetId,
        readonly name: MedicationName,
        readonly dosage: string | null,
        readonly frequency: string | null,
        readonly startDate: MedicationDate | null,
        readonly plannedEndDate: MedicationDate | null,
        readonly notes: string | null,
        readonly recordedByAccountId: RecordedByAccountId,
    ) {}

    static create(input: CreatePetMedicationInput): PetMedication {
        if (
            !(input.petId instanceof PetId) ||
            !(input.recordedByAccountId instanceof RecordedByAccountId)
        ) {
            throw new TypeError('Pet medication data is invalid');
        }

        let name: MedicationName;

        try {
            name = MedicationName.from(input.name);
        } catch (error: unknown) {
            if (error instanceof TypeError || error instanceof RangeError) {
                throw new InvalidMedicationNameValueError(error);
            }

            throw error;
        }

        const dosage: string | null = PetMedication.optionalText(
            input.dosage,
            'dosage',
            InvalidMedicationDosageValueError,
        );
        const frequency: string | null = PetMedication.optionalText(
            input.frequency,
            'frequency',
            InvalidMedicationFrequencyValueError,
        );
        const startDate: MedicationDate | null = PetMedication.optionalDate(
            input.startDate,
            InvalidMedicationStartDateValueError,
        );
        const plannedEndDate: MedicationDate | null = PetMedication.optionalDate(
            input.plannedEndDate,
            InvalidMedicationPlannedEndDateValueError,
        );

        if (
            startDate !== null &&
            plannedEndDate !== null &&
            plannedEndDate.value < startDate.value
        ) {
            throw new InvalidMedicationPlannedEndDateValueError(
                new RangeError('Planned end date cannot be before start date'),
            );
        }

        const notes: string | null = PetMedication.optionalText(
            input.notes,
            'notes',
            InvalidMedicationNotesValueError,
        );

        return new PetMedication(
            PetMedicationId.generate(),
            input.petId,
            name,
            dosage,
            frequency,
            startDate,
            plannedEndDate,
            notes,
            input.recordedByAccountId,
        );
    }

    private static optionalText(
        value: string | null | undefined,
        label: string,
        ErrorClass: new (cause: TypeError | RangeError) => TypeError,
    ): string | null {
        if (value === undefined || value === null) {
            return null;
        }

        if (typeof value !== 'string') {
            throw new ErrorClass(new TypeError(`Medication ${label} must be a string`));
        }

        const normalizedValue: string = value.trim();

        if (normalizedValue.length === 0) {
            throw new ErrorClass(new TypeError(`Medication ${label} cannot be empty`));
        }

        if (Array.from(normalizedValue).length > 2000) {
            throw new ErrorClass(
                new RangeError(`Medication ${label} must have at most 2000 characters`),
            );
        }

        return normalizedValue;
    }

    private static optionalDate(
        value: string | null | undefined,
        ErrorClass: new (cause: TypeError | RangeError) => TypeError,
    ): MedicationDate | null {
        if (value === undefined || value === null) {
            return null;
        }

        try {
            return MedicationDate.from(value);
        } catch (error: unknown) {
            if (error instanceof TypeError || error instanceof RangeError) {
                throw new ErrorClass(error);
            }

            throw error;
        }
    }
}
