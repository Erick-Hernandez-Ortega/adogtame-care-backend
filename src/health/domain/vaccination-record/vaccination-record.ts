import { randomUUID } from 'node:crypto';
import { AppliedDate } from '../applied-date/applied-date';
import { NextDueDate } from '../next-due-date/next-due-date';
import { VaccineName } from '../vaccine-name/vaccine-name';

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

export class VaccinationRecordId {
    private constructor(readonly value: string) {}

    static from(value: string): VaccinationRecordId {
        return new VaccinationRecordId(validId(value, 'Vaccination record ID'));
    }

    static generate(): VaccinationRecordId {
        return new VaccinationRecordId(randomUUID());
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

interface CreateVaccinationRecordInput {
    petId: PetId;
    vaccineName: VaccineName;
    appliedDate: AppliedDate;
    nextDueDate: NextDueDate | null;
    recordedByAccountId: RecordedByAccountId;
}

interface ReconstituteVaccinationRecordInput extends CreateVaccinationRecordInput {
    id: VaccinationRecordId;
}

interface CorrectVaccinationRecordInput {
    vaccineName?: VaccineName;
    appliedDate?: AppliedDate;
    nextDueDate?: NextDueDate | null;
}

export class NextDueDateNotAfterAppliedDateError extends RangeError {
    constructor() {
        super('Next due date must be after applied date');
    }
}

export class VaccinationRecord {
    private constructor(
        readonly id: VaccinationRecordId,
        readonly petId: PetId,
        readonly vaccineName: VaccineName,
        readonly appliedDate: AppliedDate,
        readonly nextDueDate: NextDueDate | null,
        readonly recordedByAccountId: RecordedByAccountId,
    ) {}

    static create(input: CreateVaccinationRecordInput): VaccinationRecord {
        this.validate(input);

        return new VaccinationRecord(
            VaccinationRecordId.generate(),
            input.petId,
            input.vaccineName,
            input.appliedDate,
            input.nextDueDate,
            input.recordedByAccountId,
        );
    }

    static reconstitute(input: ReconstituteVaccinationRecordInput): VaccinationRecord {
        if (!(input.id instanceof VaccinationRecordId)) {
            throw new TypeError('Vaccination record data is invalid');
        }

        this.validate(input);

        return new VaccinationRecord(
            input.id,
            input.petId,
            input.vaccineName,
            input.appliedDate,
            input.nextDueDate,
            input.recordedByAccountId,
        );
    }

    correct(input: CorrectVaccinationRecordInput): VaccinationRecord {
        if (
            (input.vaccineName !== undefined && !(input.vaccineName instanceof VaccineName)) ||
            (input.appliedDate !== undefined && !(input.appliedDate instanceof AppliedDate)) ||
            (input.nextDueDate !== undefined &&
                input.nextDueDate !== null &&
                !(input.nextDueDate instanceof NextDueDate)) ||
            (input.vaccineName === undefined &&
                input.appliedDate === undefined &&
                input.nextDueDate === undefined)
        ) {
            throw new TypeError('Vaccination record correction is invalid');
        }

        const vaccineName: VaccineName = input.vaccineName ?? this.vaccineName;
        const appliedDate: AppliedDate = input.appliedDate ?? this.appliedDate;
        const nextDueDate: NextDueDate | null =
            input.nextDueDate === undefined ? this.nextDueDate : input.nextDueDate;

        VaccinationRecord.validate({
            petId: this.petId,
            vaccineName,
            appliedDate,
            nextDueDate,
            recordedByAccountId: this.recordedByAccountId,
        });

        if (
            vaccineName.value === this.vaccineName.value &&
            appliedDate.value === this.appliedDate.value &&
            nextDueDate?.value === this.nextDueDate?.value
        ) {
            return this;
        }

        return new VaccinationRecord(
            this.id,
            this.petId,
            vaccineName,
            appliedDate,
            nextDueDate,
            this.recordedByAccountId,
        );
    }

    private static validate(input: CreateVaccinationRecordInput): void {
        if (
            !(input.petId instanceof PetId) ||
            !(input.vaccineName instanceof VaccineName) ||
            !(input.appliedDate instanceof AppliedDate) ||
            (input.nextDueDate !== null && !(input.nextDueDate instanceof NextDueDate)) ||
            !(input.recordedByAccountId instanceof RecordedByAccountId)
        ) {
            throw new TypeError('Vaccination record data is invalid');
        }

        if (input.nextDueDate !== null && input.nextDueDate.value <= input.appliedDate.value) {
            throw new NextDueDateNotAfterAppliedDateError();
        }
    }
}
