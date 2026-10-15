export const CARE_ACTIVITY_READER: unique symbol = Symbol('CARE_ACTIVITY_READER');

export interface CareActivityListItem {
    readonly id: string;
    readonly routineId: string;
    readonly completedAt: string;
    readonly completedBy: string;
    readonly timezone: string;
    readonly localDay: string;
    readonly notes: string | null;
}

export interface CareActivityReadRequest {
    readonly petId: string;
    readonly accountId: string;
    readonly from?: string;
    readonly to?: string;
    readonly routineId?: string;
}

export interface CareActivityReader {
    findAccessibleByPet(request: CareActivityReadRequest): Promise<CareActivityListItem[] | null>;
}
