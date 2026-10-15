import type { CareRoutineListItem, CareRoutineReader } from '../persistence/care-routine.reader';

export interface ListCareRoutinesQuery {
    readonly petId: string;
    readonly authenticatedAccountId: string;
}

export interface CareRoutines {
    readonly items: CareRoutineListItem[];
}

export class PetNotFoundError extends Error {
    constructor() {
        super('Pet was not found');
    }
}

export class ListCareRoutines {
    constructor(private readonly reader: CareRoutineReader) {}

    async execute(query: ListCareRoutinesQuery): Promise<CareRoutines> {
        const items: CareRoutineListItem[] | null = await this.reader.findAccessibleByPet({
            petId: query.petId,
            accountId: query.authenticatedAccountId,
        });

        if (items === null) {
            throw new PetNotFoundError();
        }

        return { items };
    }
}
