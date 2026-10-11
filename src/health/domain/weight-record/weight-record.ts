import { generateUuid, normalizeUuid } from '../../../shared/domain/uuid';
import { MeasuredDate } from '../measured-date/measured-date';
import { Weight } from '../weight/weight';

export class WeightRecordId {
    private constructor(readonly value: string) {}

    static from(value: string): WeightRecordId {
        return new WeightRecordId(normalizeUuid(value, 'Weight record ID'));
    }

    static generate(): WeightRecordId {
        return new WeightRecordId(generateUuid());
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
