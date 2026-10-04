import type {
  AllergyCategory,
  AllergySeverity,
} from '../../domain/pet-allergy/pet-allergy';

export const PET_ALLERGY_READER: unique symbol = Symbol('PET_ALLERGY_READER');

export interface PetAllergyListItem {
  readonly id: string;
  readonly allergen: string;
  readonly category: AllergyCategory;
  readonly severity: AllergySeverity;
  readonly notes: string | null;
  readonly recordedByAccountId: string;
}

export interface PetAllergyReadRequest {
  readonly petId: string;
  readonly accountId: string;
}

export interface PetAllergyReader {
  findAccessibleByPet(
    request: PetAllergyReadRequest,
  ): Promise<PetAllergyListItem[] | null>;
}
