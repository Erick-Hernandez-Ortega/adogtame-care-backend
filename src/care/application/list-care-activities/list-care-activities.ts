import { pageRequest, pageResult, type PageQuery } from '../../../shared/application/pagination';
import type { CareActivityListItem, CareActivityReader } from '../persistence/care-activity.reader';

export interface ListCareActivitiesQuery extends PageQuery {
    readonly petId: string;
    readonly authenticatedAccountId: string;
    readonly from?: string;
    readonly to?: string;
    readonly routineId?: string;
}

export interface CareActivities {
    readonly items: CareActivityListItem[];
    readonly nextCursor: string | null;
}

export class PetNotFoundError extends Error {
    constructor() {
        super('Pet was not found');
    }
}

export class ListCareActivities {
    constructor(private readonly reader: CareActivityReader) {}

    async execute(query: ListCareActivitiesQuery): Promise<CareActivities> {
        const scope: string = JSON.stringify([
            'care-activities',
            query.petId,
            query.authenticatedAccountId,
            query.from ?? null,
            query.to ?? null,
            query.routineId ?? null,
        ]);
        const page = pageRequest(query, scope);
        const items: CareActivityListItem[] | null = await this.reader.findAccessibleByPet({
            petId: query.petId,
            page,
            accountId: query.authenticatedAccountId,
            from: query.from,
            to: query.to,
            routineId: query.routineId,
        });

        if (items === null) {
            throw new PetNotFoundError();
        }

        return pageResult(items, query, scope);
    }
}
