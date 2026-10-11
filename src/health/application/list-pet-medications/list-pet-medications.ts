import type {
    ListedPetMedication,
    PetMedicationReader,
} from '../persistence/pet-medication.reader';

export interface ListPetMedicationsQuery {
    readonly petId: string;
    readonly authenticatedAccountId: string;
}

export interface PetMedications {
    readonly items: ListedPetMedication[];
}

export class PetNotFoundError extends Error {
    constructor() {
        super('Pet was not found');
    }
}

export class ListPetMedications {
    constructor(private readonly reader: PetMedicationReader) {}

    async execute(query: ListPetMedicationsQuery): Promise<PetMedications> {
        const items: ListedPetMedication[] | null = await this.reader.listIfPetReadable({
            petId: query.petId,
            authenticatedAccountId: query.authenticatedAccountId,
        });

        if (items === null) {
            throw new PetNotFoundError();
        }

        return { items };
    }
}
