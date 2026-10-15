import type { PageRequest, PageRow } from '../../../shared/application/pagination';
import type { RoutineSummaryInput } from '../../domain/care-summary/care-summary';

export const CARE_SUMMARY_READER: unique symbol = Symbol('CARE_SUMMARY_READER');

export interface CareSummaryReadRequest {
    readonly petId: string;
    readonly accountId: string;
    readonly from: string;
    readonly to: string;
    readonly routineId?: string;
    readonly page: PageRequest;
}

export interface CareSummaryRoutine extends RoutineSummaryInput, PageRow {
    readonly routineId: string;
    readonly timezone: string;
}

export interface CareSummaryReader {
    findAccessibleByPet(request: CareSummaryReadRequest): Promise<CareSummaryRoutine[] | null>;
}
