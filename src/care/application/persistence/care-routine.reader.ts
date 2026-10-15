import type { PageRequest, PageRow } from '../../../shared/application/pagination';
import type { RoutineType } from '../../domain/routine-type/routine-type';
import type { FrequencyPeriod, Weekday } from '../../domain/routine-frequency/routine-frequency';

export const CARE_ROUTINE_READER: unique symbol = Symbol('CARE_ROUTINE_READER');

export interface CareRoutineListItem extends PageRow {
    readonly id: string;
    readonly type: RoutineType;
    readonly title: string;
    readonly instructions: string | null;
    readonly frequency: {
        readonly period: FrequencyPeriod;
        readonly timesPerPeriod: number;
        readonly suggestedTimes: readonly string[];
        readonly weekdays: readonly Weekday[];
    };
    readonly timezone: string;
    readonly recordedByAccountId: string;
}

export interface CareRoutineReadRequest {
    readonly page?: PageRequest;
    readonly petId: string;
    readonly accountId: string;
}

export interface CareRoutineReader {
    findAccessibleByPet(request: CareRoutineReadRequest): Promise<CareRoutineListItem[] | null>;
}
