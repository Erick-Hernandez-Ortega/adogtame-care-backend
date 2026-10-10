export const WEIGHT_HISTORY_READER: unique symbol = Symbol('WEIGHT_HISTORY_READER');

export interface WeightHistoryPosition {
    readonly measuredDate: string;
    readonly createdAt: string;
    readonly id: string;
}

export interface WeightHistoryRow extends WeightHistoryPosition {
    readonly weightKg: string;
    readonly recordedByAccountId: string;
}

export interface WeightHistoryReadRequest {
    readonly petId: string;
    readonly accountId: string;
    readonly after: WeightHistoryPosition | null;
    readonly limit: number;
}

export interface WeightHistoryReader {
    findAccessiblePage(request: WeightHistoryReadRequest): Promise<WeightHistoryRow[] | null>;
}
