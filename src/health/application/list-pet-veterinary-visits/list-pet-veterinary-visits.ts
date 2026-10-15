import type {
    PetVeterinaryVisitListItem,
    PetVeterinaryVisitReader,
} from '../persistence/pet-veterinary-visit.reader';

export interface ListPetVeterinaryVisitsQuery {
    readonly petId: string;
    readonly authenticatedAccountId: string;
}

export interface PetVeterinaryVisits {
    readonly items: PetVeterinaryVisitListItem[];
}

export class PetNotFoundError extends Error {
    constructor() {
        super('Pet was not found');
    }
}

export class ListPetVeterinaryVisits {
    constructor(private readonly reader: PetVeterinaryVisitReader) {}

    async execute(query: ListPetVeterinaryVisitsQuery): Promise<PetVeterinaryVisits> {
        const items: PetVeterinaryVisitListItem[] | null = await this.reader.findAccessibleByPet({
            petId: query.petId,
            accountId: query.authenticatedAccountId,
        });

        if (items === null) {
            throw new PetNotFoundError();
        }

        return { items };
    }
}
