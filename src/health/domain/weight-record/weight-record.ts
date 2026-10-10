import { randomUUID } from 'node:crypto';
import { MeasuredDate } from '../measured-date/measured-date';
import { Weight } from '../weight/weight';

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

export class WeightRecordId {
    private constructor(readonly value: string) {}

    static from(value: string): WeightRecordId {
        return new WeightRecordId(validId(value, 'Weight record ID'));
    }

    static generate(): WeightRecordId {
        return new WeightRecordId(randomUUID());
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

interface CreateWeightRecordInput {
    petId: PetId;
    weight: Weight;
    measuredDate: MeasuredDate;
    recordedByAccountId: RecordedByAccountId;
}

interface ReconstituteWeightRecordInput extends CreateWeightRecordInput {
    id: WeightRecordId;
}

interface CorrectWeightRecordInput {
    weight?: Weight;
    measuredDate?: MeasuredDate;
}

export class WeightRecord {
    private constructor(
        readonly id: WeightRecordId,
        readonly petId: PetId,
        readonly weight: Weight,
        readonly measuredDate: MeasuredDate,
        readonly recordedByAccountId: RecordedByAccountId,
    ) {}

    static create(input: CreateWeightRecordInput): WeightRecord {
        this.validate(input);

        return new WeightRecord(
            WeightRecordId.generate(),
            input.petId,
            input.weight,
            input.measuredDate,
            input.recordedByAccountId,
        );
    }

    static reconstitute(input: ReconstituteWeightRecordInput): WeightRecord {
        if (!(input.id instanceof WeightRecordId)) {
            throw new TypeError('Weight record data is invalid');
        }

        this.validate(input);

        return new WeightRecord(
            input.id,
            input.petId,
            input.weight,
            input.measuredDate,
            input.recordedByAccountId,
        );
    }

    correct(input: CorrectWeightRecordInput): WeightRecord {
        if (
            (input.weight !== undefined && !(input.weight instanceof Weight)) ||
            (input.measuredDate !== undefined && !(input.measuredDate instanceof MeasuredDate)) ||
            (input.weight === undefined && input.measuredDate === undefined)
        ) {
            throw new TypeError('Weight record correction is invalid');
        }

        const weight: Weight = input.weight ?? this.weight;
        const measuredDate: MeasuredDate = input.measuredDate ?? this.measuredDate;

        if (
            weight.kilograms === this.weight.kilograms &&
            measuredDate.value === this.measuredDate.value
        ) {
            return this;
        }

        return new WeightRecord(
            this.id,
            this.petId,
            weight,
            measuredDate,
            this.recordedByAccountId,
        );
    }

    private static validate(input: CreateWeightRecordInput): void {
        if (
            !(input.petId instanceof PetId) ||
            !(input.weight instanceof Weight) ||
            !(input.measuredDate instanceof MeasuredDate) ||
            !(input.recordedByAccountId instanceof RecordedByAccountId)
        ) {
            throw new TypeError('Weight record data is invalid');
        }
    }
}
