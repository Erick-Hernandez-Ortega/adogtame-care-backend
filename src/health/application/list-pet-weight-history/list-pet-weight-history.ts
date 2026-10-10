import type { WeightHistoryReader, WeightHistoryRow } from '../persistence/weight-history.reader';
import { decodeWeightHistoryCursor, encodeWeightHistoryCursor } from './weight-history-cursor';

export interface ListPetWeightHistoryQuery {
    readonly petId: string;
    readonly authenticatedAccountId: string;
    readonly limit: number;
    readonly cursor: string | null;
}

export interface WeightHistoryItem {
    readonly id: string;
    readonly weightKg: string;
    readonly measuredDate: string;
    readonly recordedByAccountId: string;
}

export interface PetWeightHistory {
    readonly items: WeightHistoryItem[];
    readonly nextCursor: string | null;
}

export class PetNotFoundError extends Error {
    constructor() {
        super('Pet was not found');
    }
}

export class ListPetWeightHistory {
    constructor(private readonly weightHistoryReader: WeightHistoryReader) {}

    async execute(query: ListPetWeightHistoryQuery): Promise<PetWeightHistory> {
        const after =
            query.cursor === null ? null : decodeWeightHistoryCursor(query.cursor, query.petId);
        const rows: WeightHistoryRow[] | null = await this.weightHistoryReader.findAccessiblePage({
            petId: query.petId,
            accountId: query.authenticatedAccountId,
            after,
            limit: query.limit + 1,
        });

        if (rows === null) {
            throw new PetNotFoundError();
        }

        const page: WeightHistoryRow[] = rows.slice(0, query.limit);
        const last: WeightHistoryRow | undefined = page.at(-1);

        return {
            items: page.map(({ createdAt, ...rest }: WeightHistoryRow): WeightHistoryItem => rest),
            nextCursor:
                rows.length > query.limit && last !== undefined
                    ? encodeWeightHistoryCursor(query.petId, last)
                    : null,
        };
    }
}
