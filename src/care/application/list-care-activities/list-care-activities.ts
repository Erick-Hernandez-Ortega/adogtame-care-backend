import type { CareActivityListItem, CareActivityReader } from '../persistence/care-activity.reader';

export interface ListCareActivitiesQuery {
    readonly petId: string;
    readonly authenticatedAccountId: string;
    readonly from?: string;
    readonly to?: string;
    readonly routineId?: string;
}

export interface CareActivities {
    readonly items: CareActivityListItem[];
}

export class PetNotFoundError extends Error {
    constructor() {
        super('Pet was not found');
    }
}

export class ListCareActivities {
    constructor(private readonly reader: CareActivityReader) {}

    async execute(query: ListCareActivitiesQuery): Promise<CareActivities> {
        const items: CareActivityListItem[] | null = await this.reader.findAccessibleByPet({
            petId: query.petId,
            accountId: query.authenticatedAccountId,
            from: query.from,
            to: query.to,
            routineId: query.routineId,
        });

        if (items === null) {
            throw new PetNotFoundError();
        }

        return { items };
    }
}
