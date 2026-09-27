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
    if (
      !(input.petId instanceof PetId) ||
      !(input.vaccineName instanceof VaccineName) ||
      !(input.appliedDate instanceof AppliedDate) ||
      (input.nextDueDate !== null &&
        !(input.nextDueDate instanceof NextDueDate)) ||
      !(input.recordedByAccountId instanceof RecordedByAccountId)
    ) {
      throw new TypeError('Vaccination record data is invalid');
    }
    if (
      input.nextDueDate !== null &&
      input.nextDueDate.value <= input.appliedDate.value
    ) {
      throw new RangeError('Next due date must be after applied date');
    }
    return new VaccinationRecord(
      VaccinationRecordId.generate(),
      input.petId,
      input.vaccineName,
      input.appliedDate,
      input.nextDueDate,
      input.recordedByAccountId,
    );
  }
}
