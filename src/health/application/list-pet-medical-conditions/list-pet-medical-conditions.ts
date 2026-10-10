import type {
    PetMedicalConditionListItem,
    PetMedicalConditionReader,
} from '../persistence/pet-medical-condition.reader';

export interface ListPetMedicalConditionsQuery {
    readonly petId: string;
    readonly authenticatedAccountId: string;
}

export interface PetMedicalConditions {
    readonly items: PetMedicalConditionListItem[];
}

export class PetNotFoundError extends Error {
    constructor() {
        super('Pet was not found');
    }
}

export class ListPetMedicalConditions {
    constructor(private readonly reader: PetMedicalConditionReader) {}

    async execute(query: ListPetMedicalConditionsQuery): Promise<PetMedicalConditions> {
        const items: PetMedicalConditionListItem[] | null = await this.reader.findAccessibleByPet({
            petId: query.petId,
            accountId: query.authenticatedAccountId,
        });

        if (items === null) {
            throw new PetNotFoundError();
        }

        return { items };
    }
}
