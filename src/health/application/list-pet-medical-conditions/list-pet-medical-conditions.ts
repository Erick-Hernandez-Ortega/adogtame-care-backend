import { pageRequest, pageResult, type PageQuery } from '../../../shared/application/pagination';
import type {
    PetMedicalConditionListItem,
    PetMedicalConditionReader,
} from '../persistence/pet-medical-condition.reader';

export interface ListPetMedicalConditionsQuery extends PageQuery {
    readonly petId: string;
    readonly authenticatedAccountId: string;
}

export interface PetMedicalConditions {
    readonly items: PetMedicalConditionListItem[];
    readonly nextCursor: string | null;
}

export class PetNotFoundError extends Error {
    constructor() {
        super('Pet was not found');
    }
}

export class ListPetMedicalConditions {
    constructor(private readonly reader: PetMedicalConditionReader) {}

    async execute(query: ListPetMedicalConditionsQuery): Promise<PetMedicalConditions> {
        const scope: string = JSON.stringify([
            'pet-medical-conditions',
            query.petId,
            query.authenticatedAccountId,
        ]);
        const page = pageRequest(query, scope);
        const items: PetMedicalConditionListItem[] | null = await this.reader.findAccessibleByPet({
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
