export const FrequencyPeriod = {
    DAILY: 'DAILY',
    WEEKLY: 'WEEKLY',
} as const;
export type FrequencyPeriod = (typeof FrequencyPeriod)[keyof typeof FrequencyPeriod];

export const Weekday = {
    MONDAY: 'MONDAY',
    TUESDAY: 'TUESDAY',
    WEDNESDAY: 'WEDNESDAY',
    THURSDAY: 'THURSDAY',
    FRIDAY: 'FRIDAY',
    SATURDAY: 'SATURDAY',
    SUNDAY: 'SUNDAY',
} as const;
export type Weekday = (typeof Weekday)[keyof typeof Weekday];

export interface RoutineFrequencyInput {
    period: string;
    timesPerPeriod: number;
    suggestedTimes?: readonly string[] | null;
    weekdays?: readonly string[] | null;
}

export class RoutineFrequency {
    private constructor(
        readonly period: FrequencyPeriod,
        readonly timesPerPeriod: number,
        readonly suggestedTimes: readonly string[],
        readonly weekdays: readonly Weekday[],
    ) {}

    static from(input: RoutineFrequencyInput): RoutineFrequency {
        if (input === null || typeof input !== 'object') {
            throw new TypeError('Routine frequency is invalid');
        }

        if (input.period !== FrequencyPeriod.DAILY && input.period !== FrequencyPeriod.WEEKLY) {
            throw new TypeError('Routine frequency period must be DAILY or WEEKLY');
        }

        if (!Number.isSafeInteger(input.timesPerPeriod) || input.timesPerPeriod < 1) {
            throw new RangeError('Routine times per period must be a positive safe integer');
        }

        if (!Array.isArray(input.suggestedTimes ?? []) || !Array.isArray(input.weekdays ?? [])) {
            throw new TypeError('Routine suggested times and weekdays must be arrays');
        }

        const suggestedTimes: readonly string[] = input.suggestedTimes ?? [];
        const weekdays: readonly string[] = input.weekdays ?? [];

        if (suggestedTimes.length > 24 || new Set(suggestedTimes).size !== suggestedTimes.length) {
            throw new TypeError('Routine suggested times must contain at most 24 unique entries');
        }

        if (weekdays.length > 7 || new Set(weekdays).size !== weekdays.length) {
            throw new TypeError('Routine weekdays must contain at most 7 unique entries');
        }

        for (const suggestedTime of suggestedTimes) {
            if (
                typeof suggestedTime !== 'string' ||
                suggestedTime.length !== 5 ||
                !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(suggestedTime)
            ) {
                throw new TypeError('Routine suggested times must use HH:mm');
            }
        }

        if (input.period === FrequencyPeriod.DAILY && weekdays.length > 0) {
            throw new TypeError('Routine weekdays are only supported for WEEKLY frequency');
        }

        for (const weekday of weekdays) {
            if (
                !Object.values(Weekday).some(
                    (supportedDay: string): boolean => supportedDay === weekday,
                )
            ) {
                throw new TypeError('Routine weekday is invalid');
            }
        }

        return new RoutineFrequency(
            input.period,
            input.timesPerPeriod,
            Object.freeze([...suggestedTimes]),
            Object.freeze(weekdays.map((weekday: string): Weekday => weekday as Weekday)),
        );
    }
}
