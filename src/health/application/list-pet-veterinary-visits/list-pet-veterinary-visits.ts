import { pageRequest, pageResult, type PageQuery } from '../../../shared/application/pagination';
import type {
    PetVeterinaryVisitListItem,
    PetVeterinaryVisitReader,
} from '../persistence/pet-veterinary-visit.reader';

export interface ListPetVeterinaryVisitsQuery extends PageQuery {
    readonly petId: string;
    readonly authenticatedAccountId: string;
}

export interface PetVeterinaryVisits {
    readonly items: PetVeterinaryVisitListItem[];
    readonly nextCursor: string | null;
}

export class PetNotFoundError extends Error {
    constructor() {
        super('Pet was not found');
    }
}

export class ListPetVeterinaryVisits {
    constructor(private readonly reader: PetVeterinaryVisitReader) {}

    async execute(query: ListPetVeterinaryVisitsQuery): Promise<PetVeterinaryVisits> {
        const scope: string = JSON.stringify([
            'pet-veterinary-visits',
            query.petId,
            query.authenticatedAccountId,
        ]);
        const page = pageRequest(query, scope);
        const items: PetVeterinaryVisitListItem[] | null = await this.reader.findAccessibleByPet({
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
