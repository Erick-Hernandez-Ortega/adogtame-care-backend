import type {
    VaccinationHistoryReader,
    VaccinationHistoryRow,
} from '../persistence/vaccination-history.reader';
import {
    decodeVaccinationHistoryCursor,
    encodeVaccinationHistoryCursor,
} from './vaccination-history-cursor';

export interface ListPetVaccinationHistoryQuery {
    readonly petId: string;
    readonly authenticatedAccountId: string;
    readonly limit: number;
    readonly cursor: string | null;
}

export interface VaccinationHistoryItem {
    readonly id: string;
    readonly vaccineName: string;
    readonly appliedDate: string;
    readonly nextDueDate: string | null;
    readonly recordedByAccountId: string;
}

export interface PetVaccinationHistory {
    readonly items: VaccinationHistoryItem[];
    readonly nextCursor: string | null;
}

export class PetNotFoundError extends Error {
    constructor() {
        super('Pet was not found');
    }
}

export class ListPetVaccinationHistory {
    constructor(private readonly reader: VaccinationHistoryReader) {}

    async execute(query: ListPetVaccinationHistoryQuery): Promise<PetVaccinationHistory> {
        const after =
            query.cursor === null
                ? null
                : decodeVaccinationHistoryCursor(query.cursor, query.petId);
        const rows: VaccinationHistoryRow[] | null = await this.reader.findAccessiblePage({
            petId: query.petId,
            accountId: query.authenticatedAccountId,
            after,
            limit: query.limit + 1,
        });

        if (rows === null) {
            throw new PetNotFoundError();
        }

        const page: VaccinationHistoryRow[] = rows.slice(0, query.limit);
        const last: VaccinationHistoryRow | undefined = page.at(-1);

        return {
            items: page.map(
                ({ createdAt, ...rest }: VaccinationHistoryRow): VaccinationHistoryItem => rest,
            ),
            nextCursor:
                rows.length > query.limit && last !== undefined
                    ? encodeVaccinationHistoryCursor(query.petId, last)
                    : null,
        };
    }
}
