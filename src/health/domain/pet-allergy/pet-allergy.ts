import { randomUUID } from 'node:crypto';
import { Allergen } from '../allergen/allergen';

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

export class PetAllergyId {
  private constructor(readonly value: string) {}

  static from(value: string): PetAllergyId {
    return new PetAllergyId(validId(value, 'Pet allergy ID'));
  }

  static generate(): PetAllergyId {
    return new PetAllergyId(randomUUID());
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

export const AllergyCategory = {
  FOOD: 'FOOD',
  MEDICATION: 'MEDICATION',
  ENVIRONMENTAL: 'ENVIRONMENTAL',
  OTHER: 'OTHER',
} as const;
export type AllergyCategory =
  (typeof AllergyCategory)[keyof typeof AllergyCategory];

export const AllergySeverity = {
  MILD: 'MILD',
  MODERATE: 'MODERATE',
  SEVERE: 'SEVERE',
  UNKNOWN: 'UNKNOWN',
} as const;
export type AllergySeverity =
  (typeof AllergySeverity)[keyof typeof AllergySeverity];

export class InvalidAllergyCategoryValueError extends TypeError {
  constructor() {
    super('Allergy category must be FOOD, MEDICATION, ENVIRONMENTAL, or OTHER');
  }
}
export class InvalidAllergySeverityValueError extends TypeError {
  constructor() {
    super('Allergy severity must be MILD, MODERATE, SEVERE, or UNKNOWN');
  }
}
export class InvalidAllergyNotesValueError extends TypeError {
  constructor(message: string) {
    super(message);
  }
}

export class InvalidAllergenValueError extends TypeError {
  constructor(cause: TypeError | RangeError) {
    super(cause.message, { cause });
  }
}

interface ReconstitutePetAllergyInput extends CreatePetAllergyInput {
  id: PetAllergyId;
}

interface CorrectPetAllergyInput {
  allergen?: string;
  category?: string;
  severity?: string;
  notes?: string | null;
}

interface ValidatedPetAllergyInformation {
  category: AllergyCategory;
  severity: AllergySeverity;
  notes: string | null;
}

interface CreatePetAllergyInput {
  petId: PetId;
  allergen: Allergen;
  category: string;
  severity: string;
  notes?: string | null;
  recordedByAccountId: RecordedByAccountId;
}

export class PetAllergy {
  private constructor(
    readonly id: PetAllergyId,
    readonly petId: PetId,
    readonly allergen: Allergen,
    readonly category: AllergyCategory,
    readonly severity: AllergySeverity,
    readonly notes: string | null,
    readonly recordedByAccountId: RecordedByAccountId,
  ) {}

  static create(input: CreatePetAllergyInput): PetAllergy {
    const { category, severity, notes } = PetAllergy.validate(input);
    return new PetAllergy(
      PetAllergyId.generate(),
      input.petId,
      input.allergen,
      category,
      severity,
      notes,
      input.recordedByAccountId,
    );
  }

  static reconstitute(input: ReconstitutePetAllergyInput): PetAllergy {
    if (!(input.id instanceof PetAllergyId)) {
      throw new TypeError('Pet allergy data is invalid');
    }
    const { category, severity, notes } = PetAllergy.validate(input);
    return new PetAllergy(
      input.id,
      input.petId,
      input.allergen,
      category,
      severity,
      notes,
      input.recordedByAccountId,
    );
  }

  correct(input: CorrectPetAllergyInput): PetAllergy {
    if (
      input.allergen === undefined &&
      input.category === undefined &&
      input.severity === undefined &&
      input.notes === undefined
    ) {
      throw new TypeError('Pet allergy correction is invalid');
    }
    let allergen: Allergen = this.allergen;
    if (input.allergen !== undefined) {
      try {
        allergen = Allergen.from(input.allergen);
      } catch (error: unknown) {
        if (error instanceof TypeError || error instanceof RangeError) {
          throw new InvalidAllergenValueError(error);
        }
        throw error;
      }
    }
    const candidate: PetAllergy = PetAllergy.reconstitute({
      id: this.id,
      petId: this.petId,
      allergen,
      category: input.category === undefined ? this.category : input.category,
      severity: input.severity === undefined ? this.severity : input.severity,
      notes: input.notes === undefined ? this.notes : input.notes,
      recordedByAccountId: this.recordedByAccountId,
    });
    if (
      candidate.allergen.value === this.allergen.value &&
      candidate.category === this.category &&
      candidate.severity === this.severity &&
      candidate.notes === this.notes
    ) {
      return this;
    }
    return candidate;
  }

  private static validate(
    input: CreatePetAllergyInput,
  ): ValidatedPetAllergyInformation {
    if (
      !(input.petId instanceof PetId) ||
      !(input.allergen instanceof Allergen) ||
      !(input.recordedByAccountId instanceof RecordedByAccountId)
    ) {
      throw new TypeError('Pet allergy data is invalid');
    }
    const category: AllergyCategory = PetAllergy.category(input.category);
    const severity: AllergySeverity = PetAllergy.severity(input.severity);
    const notes: string | null = PetAllergy.notes(input.notes);
    return { category, severity, notes };
  }

  private static category(value: string): AllergyCategory {
    switch (value) {
      case AllergyCategory.FOOD:
      case AllergyCategory.MEDICATION:
      case AllergyCategory.ENVIRONMENTAL:
      case AllergyCategory.OTHER:
        return value;
      default:
        throw new InvalidAllergyCategoryValueError();
    }
  }

  private static severity(value: string): AllergySeverity {
    switch (value) {
      case AllergySeverity.MILD:
      case AllergySeverity.MODERATE:
      case AllergySeverity.SEVERE:
      case AllergySeverity.UNKNOWN:
        return value;
      default:
        throw new InvalidAllergySeverityValueError();
    }
  }

  private static notes(value: string | null | undefined): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string')
      throw new InvalidAllergyNotesValueError('Allergy notes must be a string');
    const normalizedValue: string = value.trim();
    if (normalizedValue.length === 0)
      throw new InvalidAllergyNotesValueError('Allergy notes cannot be empty');
    if (Array.from(normalizedValue).length > 2000)
      throw new InvalidAllergyNotesValueError(
        'Allergy notes must have at most 2000 characters',
      );
    return normalizedValue;
  }
}
