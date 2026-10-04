import { Allergen } from '../../domain/allergen/allergen';
import {
  PetAllergy,
  PetId,
  RecordedByAccountId,
  InvalidAllergyCategoryValueError,
  InvalidAllergySeverityValueError,
  InvalidAllergyNotesValueError,
  type AllergyCategory,
  type AllergySeverity,
} from '../../domain/pet-allergy/pet-allergy';
import type {
  PetAllergyRepository,
  CreatePetAllergyOutcome,
} from '../persistence/pet-allergy.repository';

export interface RecordPetAllergyCommand {
  petId: string;
  authenticatedAccountId: string;
  allergen: string;
  category: string;
  severity: string;
  notes?: string | null;
}
export interface RecordedPetAllergy {
  id: string;
  petId: string;
  allergen: string;
  category: AllergyCategory;
  severity: AllergySeverity;
  notes: string | null;
  recordedByAccountId: string;
}
export class InvalidAllergenError extends Error {
  constructor(cause: TypeError | RangeError) {
    super(cause.message, { cause });
  }
}
export class InvalidAllergyCategoryError extends Error {
  constructor(cause: InvalidAllergyCategoryValueError) {
    super(cause.message, { cause });
  }
}
export class InvalidAllergySeverityError extends Error {
  constructor(cause: InvalidAllergySeverityValueError) {
    super(cause.message, { cause });
  }
}
export class InvalidAllergyNotesError extends Error {
  constructor(cause: InvalidAllergyNotesValueError) {
    super(cause.message, { cause });
  }
}
export class PetNotFoundError extends Error {
  constructor() {
    super('Pet was not found');
  }
}

export class RecordPetAllergy {
  constructor(private readonly repository: PetAllergyRepository) {}

  async execute(command: RecordPetAllergyCommand): Promise<RecordedPetAllergy> {
    let allergen: Allergen;
    try {
      allergen = Allergen.from(command.allergen);
    } catch (error: unknown) {
      if (error instanceof TypeError || error instanceof RangeError)
        throw new InvalidAllergenError(error);
      throw error;
    }
    let allergy: PetAllergy;
    try {
      allergy = PetAllergy.create({
        petId: PetId.from(command.petId),
        allergen,
        category: command.category,
        severity: command.severity,
        notes: command.notes,
        recordedByAccountId: RecordedByAccountId.from(
          command.authenticatedAccountId,
        ),
      });
    } catch (error: unknown) {
      if (error instanceof InvalidAllergyCategoryValueError)
        throw new InvalidAllergyCategoryError(error);
      if (error instanceof InvalidAllergySeverityValueError)
        throw new InvalidAllergySeverityError(error);
      if (error instanceof InvalidAllergyNotesValueError)
        throw new InvalidAllergyNotesError(error);
      throw error;
    }
    const outcome: CreatePetAllergyOutcome =
      await this.repository.createIfPetWritable(
        allergy,
        command.authenticatedAccountId,
      );
    if (outcome === 'PET_NOT_FOUND') throw new PetNotFoundError();
    return {
      id: allergy.id.value,
      petId: allergy.petId.value,
      allergen: allergy.allergen.value,
      category: allergy.category,
      severity: allergy.severity,
      notes: allergy.notes,
      recordedByAccountId: allergy.recordedByAccountId.value,
    };
  }
}
