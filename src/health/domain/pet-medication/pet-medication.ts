import { normalizeRequiredText } from '../../../shared/domain/text';
import { generateUuid, normalizeUuid } from '../../../shared/domain/uuid';
import { MedicationName } from '../medication-name/medication-name';
import { MedicationDate } from '../medication-date/medication-date';

export class PetMedicationId {
    private constructor(readonly value: string) {}

    static from(value: string): PetMedicationId {
        return new PetMedicationId(normalizeUuid(value, 'Pet medication ID'));
    }

    static generate(this: void): PetMedicationId {
        return new PetMedicationId(generateUuid());
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

export const MedicationStatus = {
    OPEN: 'OPEN',
    COMPLETED: 'COMPLETED',
    DISCONTINUED: 'DISCONTINUED',
} as const;
export type MedicationStatus = (typeof MedicationStatus)[keyof typeof MedicationStatus];

export class InvalidMedicationEndedDateValueError extends TypeError {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}

export class InvalidMedicationDiscontinuationReasonValueError extends TypeError {
    constructor(cause: TypeError | RangeError) {
        super(cause.message, { cause });
    }
}

export class MedicationLifecycleConflictError extends Error {
    constructor() {
        super('Medication lifecycle action conflicts with the current report');
    }
}

interface MedicationClosureInput {
    endedDate: string | null;
    discontinuationReason?: string | null;
}

interface MedicationLifecycle {
    status: MedicationStatus;
    endedDate: string | null;
    discontinuationReason: string | null;
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

interface ReconstitutePetMedicationInput {
    status: string;
    endedDate: string | null;
    discontinuationReason: string | null;
    id: PetMedicationId;
    petId: PetId;
    recordedByAccountId: RecordedByAccountId;
    name: string;
    dosage: string | null;
    frequency: string | null;
    startDate: string | null;
    plannedEndDate: string | null;
    notes: string | null;
}

interface CorrectPetMedicationInput {
    endedDate?: string | null;
    discontinuationReason?: string | null;
    name?: string;
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
        readonly status: MedicationStatus,
        readonly endedDate: MedicationDate | null,
        readonly discontinuationReason: string | null,
    ) {}

    static create(input: CreatePetMedicationInput): PetMedication {
        return PetMedication.build(input);
    }

    static reconstitute(input: ReconstitutePetMedicationInput): PetMedication {
        try {
            if (
                !(input.id instanceof PetMedicationId) ||
                input.dosage === undefined ||
                input.frequency === undefined ||
                input.startDate === undefined ||
                input.plannedEndDate === undefined ||
                input.notes === undefined
            ) {
                throw new TypeError('Persisted pet medication data is invalid');
            }

            if (
                input.status !== MedicationStatus.OPEN &&
                input.status !== MedicationStatus.COMPLETED &&
                input.status !== MedicationStatus.DISCONTINUED
            ) {
                throw new TypeError('Persisted medication status is invalid');
            }

            const medication: PetMedication = PetMedication.build(input, input.id, {
                ...input,
                status: input.status,
            });

            if (
                medication.name.value !== input.name ||
                medication.dosage !== input.dosage ||
                medication.frequency !== input.frequency ||
                medication.notes !== input.notes ||
                medication.discontinuationReason !== input.discontinuationReason
            ) {
                throw new TypeError('Persisted pet medication text must be normalized');
            }

            return medication;
        } catch (error: unknown) {
            if (
                error instanceof TypeError ||
                error instanceof RangeError ||
                error instanceof MedicationLifecycleConflictError
            ) {
                throw new TypeError('Persisted pet medication data is invalid', { cause: error });
            }

            throw error;
        }
    }

    correct(input: CorrectPetMedicationInput, getToday?: () => string): PetMedication {
        if (
            input.name === undefined &&
            input.dosage === undefined &&
            input.frequency === undefined &&
            input.startDate === undefined &&
            input.plannedEndDate === undefined &&
            input.notes === undefined &&
            input.endedDate === undefined &&
            input.discontinuationReason === undefined
        ) {
            throw new TypeError('Pet medication correction is invalid');
        }

        if (
            (input.endedDate !== undefined && this.status === MedicationStatus.OPEN) ||
            (input.discontinuationReason !== undefined &&
                this.status !== MedicationStatus.DISCONTINUED)
        ) {
            throw new MedicationLifecycleConflictError();
        }

        const endedDate: string | null =
            input.endedDate === undefined
                ? (this.endedDate?.value ?? null)
                : PetMedication.reportedEndedDate(input.endedDate, getToday);

        const candidate: PetMedication = PetMedication.build(
            {
                petId: this.petId,
                recordedByAccountId: this.recordedByAccountId,
                name: input.name === undefined ? this.name.value : input.name,
                dosage: input.dosage === undefined ? this.dosage : input.dosage,
                frequency: input.frequency === undefined ? this.frequency : input.frequency,
                startDate:
                    input.startDate === undefined
                        ? (this.startDate?.value ?? null)
                        : input.startDate,
                plannedEndDate:
                    input.plannedEndDate === undefined
                        ? (this.plannedEndDate?.value ?? null)
                        : input.plannedEndDate,
                notes: input.notes === undefined ? this.notes : input.notes,
            },
            this.id,
            {
                status: this.status,
                endedDate,
                discontinuationReason:
                    input.discontinuationReason === undefined
                        ? this.discontinuationReason
                        : input.discontinuationReason,
            },
        );

        if (
            candidate.name.value === this.name.value &&
            candidate.dosage === this.dosage &&
            candidate.frequency === this.frequency &&
            candidate.startDate?.value === this.startDate?.value &&
            candidate.plannedEndDate?.value === this.plannedEndDate?.value &&
            candidate.notes === this.notes &&
            candidate.endedDate?.value === this.endedDate?.value &&
            candidate.discontinuationReason === this.discontinuationReason
        ) {
            return this;
        }

        return candidate;
    }

    complete(input: MedicationClosureInput, getToday: () => string): PetMedication {
        return this.close(MedicationStatus.COMPLETED, input, getToday);
    }

    discontinue(input: MedicationClosureInput, getToday: () => string): PetMedication {
        return this.close(MedicationStatus.DISCONTINUED, input, getToday);
    }

    reopen(): PetMedication {
        if (this.status === MedicationStatus.OPEN) {
            return this;
        }

        return PetMedication.build(this.values(), this.id, {
            status: MedicationStatus.OPEN,
            endedDate: null,
            discontinuationReason: null,
        });
    }

    private close(
        status: MedicationStatus,
        input: MedicationClosureInput,
        getToday: () => string,
    ): PetMedication {
        if (this.status !== MedicationStatus.OPEN && this.status !== status) {
            throw new MedicationLifecycleConflictError();
        }

        const endedDate: string | null = PetMedication.reportedEndedDate(input.endedDate, getToday);
        const candidate: PetMedication = PetMedication.build(this.values(), this.id, {
            status,
            endedDate,
            discontinuationReason: input.discontinuationReason ?? null,
        });

        if (this.status === status) {
            if (
                candidate.endedDate?.value !== this.endedDate?.value ||
                candidate.discontinuationReason !== this.discontinuationReason
            ) {
                throw new MedicationLifecycleConflictError();
            }

            return this;
        }

        return candidate;
    }

    private values(): CreatePetMedicationInput {
        return {
            petId: this.petId,
            recordedByAccountId: this.recordedByAccountId,
            name: this.name.value,
            dosage: this.dosage,
            frequency: this.frequency,
            startDate: this.startDate?.value ?? null,
            plannedEndDate: this.plannedEndDate?.value ?? null,
            notes: this.notes,
        };
    }

    private static reportedEndedDate(value: string | null, getToday?: () => string): string | null {
        if (value === null) {
            return null;
        }

        const date: MedicationDate | null = PetMedication.optionalDate(
            value,
            InvalidMedicationEndedDateValueError,
        );

        if (date === null) {
            throw new InvalidMedicationEndedDateValueError(
                new TypeError('Ended date must be explicit'),
            );
        }

        if (getToday === undefined) {
            throw new TypeError('Today is required to validate a reported ended date');
        }

        if (date.value > getToday()) {
            throw new InvalidMedicationEndedDateValueError(
                new RangeError('Ended date cannot be in the future'),
            );
        }

        return date.value;
    }

    private static build(
        input: CreatePetMedicationInput,
        id?: PetMedicationId,
        lifecycle: MedicationLifecycle = {
            status: MedicationStatus.OPEN,
            endedDate: null,
            discontinuationReason: null,
        },
    ): PetMedication {
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

        if (!Object.values(MedicationStatus).includes(lifecycle.status)) {
            throw new TypeError('Medication status must be OPEN, COMPLETED or DISCONTINUED');
        }

        if (lifecycle.endedDate === undefined || lifecycle.discontinuationReason === undefined) {
            throw new TypeError('Persisted medication lifecycle data is invalid');
        }

        if (
            (lifecycle.status === MedicationStatus.OPEN && lifecycle.endedDate !== null) ||
            (lifecycle.status !== MedicationStatus.DISCONTINUED &&
                lifecycle.discontinuationReason !== null)
        ) {
            throw new MedicationLifecycleConflictError();
        }

        const endedDate: MedicationDate | null = PetMedication.optionalDate(
            lifecycle.endedDate,
            InvalidMedicationEndedDateValueError,
        );
        const discontinuationReason: string | null = PetMedication.optionalText(
            lifecycle.discontinuationReason,
            'discontinuation reason',
            InvalidMedicationDiscontinuationReasonValueError,
        );

        if (
            lifecycle.status === MedicationStatus.COMPLETED &&
            startDate !== null &&
            endedDate !== null &&
            endedDate.value < startDate.value
        ) {
            throw new InvalidMedicationEndedDateValueError(
                new RangeError('Completed ended date cannot be before start date'),
            );
        }

        return new PetMedication(
            id ?? PetMedicationId.generate(),
            input.petId,
            name,
            dosage,
            frequency,
            startDate,
            plannedEndDate,
            notes,
            input.recordedByAccountId,
            lifecycle.status,
            endedDate,
            discontinuationReason,
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

        try {
            return normalizeRequiredText(value, `Medication ${label}`, 2000);
        } catch (error: unknown) {
            if (error instanceof TypeError || error instanceof RangeError) {
                throw new ErrorClass(error);
            }

            throw error;
        }
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
