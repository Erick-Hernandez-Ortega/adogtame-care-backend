export const VACCINATION_HISTORY_READER: unique symbol = Symbol('VACCINATION_HISTORY_READER');

export interface VaccinationHistoryPosition {
    readonly appliedDate: string;
    readonly createdAt: string;
    readonly id: string;
}

export interface VaccinationHistoryRow extends VaccinationHistoryPosition {
    readonly vaccineName: string;
    readonly nextDueDate: string | null;
    readonly recordedByAccountId: string;
}

export interface VaccinationHistoryReadRequest {
    readonly petId: string;
    readonly accountId: string;
    readonly after: VaccinationHistoryPosition | null;
    readonly limit: number;
}

export interface VaccinationHistoryReader {
    findAccessiblePage(
        request: VaccinationHistoryReadRequest,
    ): Promise<VaccinationHistoryRow[] | null>;
}
