import { pageRequest, pageResult, type PageQuery } from '../../../shared/application/pagination';
import type { PetAllergyListItem, PetAllergyReader } from '../persistence/pet-allergy.reader';

export interface ListPetAllergiesQuery extends PageQuery {
    readonly petId: string;
    readonly authenticatedAccountId: string;
}

export interface PetAllergies {
    readonly items: PetAllergyListItem[];
    readonly nextCursor: string | null;
}

export class PetNotFoundError extends Error {
    constructor() {
        super('Pet was not found');
    }
}

export class ListPetAllergies {
    constructor(private readonly reader: PetAllergyReader) {}

    async execute(query: ListPetAllergiesQuery): Promise<PetAllergies> {
        const scope: string = JSON.stringify([
            'pet-allergies',
            query.petId,
            query.authenticatedAccountId,
        ]);
        const page = pageRequest(query, scope);
        const items: PetAllergyListItem[] | null = await this.reader.findAccessibleByPet({
            petId: query.petId,
            page,
            accountId: query.authenticatedAccountId,
        });

        if (items === null) {
            throw new PetNotFoundError();
        }

        return pageResult(items, query, scope);
    }
}
