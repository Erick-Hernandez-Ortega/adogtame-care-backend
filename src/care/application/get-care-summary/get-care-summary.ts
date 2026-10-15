import { pageRequest, pageResult, type PageQuery } from '../../../shared/application/pagination';
import { summarizeRoutine, type RoutineSummary } from '../../domain/care-summary/care-summary';
import type { CareSummaryReader } from '../persistence/care-summary.reader';

export interface GetCareSummaryQuery extends PageQuery {
    readonly petId: string;
    readonly authenticatedAccountId: string;
    readonly from: string;
    readonly to: string;
    readonly routineId?: string;
}

export interface CareSummaryItem extends RoutineSummary {
    readonly routineId: string;
    readonly timezone: string;
}

export interface CareSummary {
    readonly items: CareSummaryItem[];
    readonly nextCursor: string | null;
}

export class PetNotFoundError extends Error {
    constructor() {
        super('Pet was not found');
    }
}

export function careSummaryScope(query: GetCareSummaryQuery): string {
    return JSON.stringify([
        'care-summary',
        query.petId,
        query.authenticatedAccountId,
        query.from,
        query.to,
        query.routineId ?? null,
    ]);
}

export class GetCareSummary {
    constructor(private readonly reader: CareSummaryReader) {}

    async execute(query: GetCareSummaryQuery): Promise<CareSummary> {
        const scope: string = careSummaryScope(query);
        const routines = await this.reader.findAccessibleByPet({
            petId: query.petId,
            accountId: query.authenticatedAccountId,
            from: query.from,
            to: query.to,
            routineId: query.routineId,
            page: pageRequest(query, scope),
        });

        if (routines === null) {
            throw new PetNotFoundError();
        }

        const page = pageResult(routines, query, scope);

        return {
            nextCursor: page.nextCursor,
            items: page.items.map((routine): CareSummaryItem => ({
                routineId: routine.routineId,
                timezone: routine.timezone,
                ...summarizeRoutine(routine, query.from, query.to),
            })),
        };
    }
}
