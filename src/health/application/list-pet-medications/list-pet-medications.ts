import { pageRequest, pageResult, type PageQuery } from '../../../shared/application/pagination';
import type {
    ListedPetMedication,
    PetMedicationReader,
} from '../persistence/pet-medication.reader';

export interface ListPetMedicationsQuery extends PageQuery {
    readonly petId: string;
    readonly authenticatedAccountId: string;
}

export interface PetMedications {
    readonly items: ListedPetMedication[];
    readonly nextCursor: string | null;
}

export class PetNotFoundError extends Error {
    constructor() {
        super('Pet was not found');
    }
}

export class ListPetMedications {
    constructor(private readonly reader: PetMedicationReader) {}

    async execute(query: ListPetMedicationsQuery): Promise<PetMedications> {
        const scope: string = JSON.stringify([
            'pet-medications',
            query.petId,
            query.authenticatedAccountId,
        ]);
        const page = pageRequest(query, scope);
        const items: ListedPetMedication[] | null = await this.reader.listIfPetReadable({
            petId: query.petId,
            page,
            authenticatedAccountId: query.authenticatedAccountId,
        });

        if (items === null) {
            throw new PetNotFoundError();
        }

        return pageResult(items, query, scope);
    }
}
