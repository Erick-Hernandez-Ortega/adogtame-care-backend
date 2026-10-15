import { pageRequest, pageResult, type PageQuery } from '../../../shared/application/pagination';
import type { CareRoutineListItem, CareRoutineReader } from '../persistence/care-routine.reader';

export interface ListCareRoutinesQuery extends PageQuery {
    readonly petId: string;
    readonly authenticatedAccountId: string;
}

export interface CareRoutines {
    readonly items: CareRoutineListItem[];
    readonly nextCursor: string | null;
}

export class PetNotFoundError extends Error {
    constructor() {
        super('Pet was not found');
    }
}

export class ListCareRoutines {
    constructor(private readonly reader: CareRoutineReader) {}

    async execute(query: ListCareRoutinesQuery): Promise<CareRoutines> {
        const scope: string = JSON.stringify([
            'care-routines',
            query.petId,
            query.authenticatedAccountId,
        ]);
        const page = pageRequest(query, scope);
        const items: CareRoutineListItem[] | null = await this.reader.findAccessibleByPet({
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
