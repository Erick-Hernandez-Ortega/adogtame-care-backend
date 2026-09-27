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

export class WeightRecord {
  private constructor(
    readonly id: WeightRecordId,
    readonly petId: PetId,
    readonly weight: Weight,
    readonly measuredDate: MeasuredDate,
    readonly recordedByAccountId: RecordedByAccountId,
  ) {}

  static create(input: CreateWeightRecordInput): WeightRecord {
    if (
      !(input.petId instanceof PetId) ||
      !(input.weight instanceof Weight) ||
      !(input.measuredDate instanceof MeasuredDate) ||
      !(input.recordedByAccountId instanceof RecordedByAccountId)
    ) {
      throw new TypeError('Weight record data is invalid');
    }

    return new WeightRecord(
      WeightRecordId.generate(),
      input.petId,
      input.weight,
      input.measuredDate,
      input.recordedByAccountId,
    );
  }
}
