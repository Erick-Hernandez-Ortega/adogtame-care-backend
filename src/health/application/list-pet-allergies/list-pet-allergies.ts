import type {
  PetAllergyListItem,
  PetAllergyReader,
} from '../persistence/pet-allergy.reader';

export interface ListPetAllergiesQuery {
  readonly petId: string;
  readonly authenticatedAccountId: string;
}

export interface PetAllergies {
  readonly items: PetAllergyListItem[];
}

export class PetNotFoundError extends Error {
  constructor() {
    super('Pet was not found');
  }
}

export class ListPetAllergies {
  constructor(private readonly reader: PetAllergyReader) {}

  async execute(query: ListPetAllergiesQuery): Promise<PetAllergies> {
    const items: PetAllergyListItem[] | null =
      await this.reader.findAccessibleByPet({
        petId: query.petId,
        accountId: query.authenticatedAccountId,
      });
    if (items === null) throw new PetNotFoundError();
    return { items };
  }
}
