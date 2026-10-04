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
    return new PetMedicalConditionId(
      validId(value, 'Pet medical condition ID'),
    );
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

export class PetMedicalCondition {
  readonly status: typeof MedicalConditionStatus.ACTIVE =
    MedicalConditionStatus.ACTIVE;

  private constructor(
    readonly id: PetMedicalConditionId,
    readonly petId: PetId,
    readonly name: MedicalConditionName,
    readonly diagnosedDate: DiagnosedDate | null,
    readonly notes: string | null,
    readonly recordedByAccountId: RecordedByAccountId,
  ) {}

  static create(input: CreatePetMedicalConditionInput): PetMedicalCondition {
    if (
      !(input.petId instanceof PetId) ||
      !(input.name instanceof MedicalConditionName) ||
      !(input.recordedByAccountId instanceof RecordedByAccountId) ||
      (input.diagnosedDate !== undefined &&
        input.diagnosedDate !== null &&
        !(input.diagnosedDate instanceof DiagnosedDate))
    ) {
      throw new TypeError('Pet medical condition data is invalid');
    }
    const notes: string | null = PetMedicalCondition.normalizeNotes(
      input.notes,
    );
    return new PetMedicalCondition(
      PetMedicalConditionId.generate(),
      input.petId,
      input.name,
      input.diagnosedDate ?? null,
      notes,
      input.recordedByAccountId,
    );
  }

  private static normalizeNotes(
    value: string | null | undefined,
  ): string | null {
    if (value === undefined || value === null) return null;
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
