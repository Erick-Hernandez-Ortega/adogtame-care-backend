import { RoutineFrequency, Weekday } from '../routine-frequency/routine-frequency';

export interface CareSummaryCounts {
    readonly expected: number;
    readonly completed: number;
    readonly missed: number;
}

export interface CareSummaryDay extends CareSummaryCounts {
    readonly localDay: string;
}

export interface CareSummaryWeek extends CareSummaryCounts {
    readonly weekStart: string;
}

export interface RoutineSummaryInput {
    readonly frequency: RoutineFrequency;
    readonly createdLocalDay: string;
    readonly completedByDay: Readonly<Record<string, number>>;
}

export interface RoutineSummary {
    readonly days: CareSummaryDay[];
    readonly weeks: CareSummaryWeek[];
}

const DAY_MILLISECONDS: number = 86_400_000;
const weekdays: readonly Weekday[] = Object.values(Weekday);

function dayNumber(value: string): number {
    return Date.parse(`${value}T00:00:00Z`) / DAY_MILLISECONDS;
}

function localDay(value: number): string {
    return new Date(value * DAY_MILLISECONDS).toISOString().slice(0, 10);
}

function weekdayIndex(value: number): number {
    return (((value + 3) % 7) + 7) % 7;
}

function weekStart(value: number): number {
    return value - weekdayIndex(value);
}

function counts(expected: number, completed: number): CareSummaryCounts {
    return { expected, completed, missed: Math.max(expected - completed, 0) };
}

export function summarizeRoutine(
    input: RoutineSummaryInput,
    from: string,
    to: string,
): RoutineSummary {
    const days: CareSummaryDay[] = [];
    const weeks: CareSummaryWeek[] = [];
    const firstDay: number = dayNumber(from);
    const lastDay: number = dayNumber(to);
    const creationDay: number = dayNumber(input.createdLocalDay);
    const frequency: RoutineFrequency = input.frequency;
    const selectedDays: readonly Weekday[] = weekdays.filter((weekday): boolean =>
        frequency.weekdays.includes(weekday),
    );

    if (frequency.period === 'WEEKLY' && selectedDays.length === 0) {
        for (let start: number = weekStart(firstDay); start <= lastDay; start += 7) {
            if (start < weekStart(creationDay)) {
                continue;
            }

            let completed: number = 0;

            for (const [date, total] of Object.entries(input.completedByDay)) {
                const day: number = dayNumber(date);

                if (day >= start && day < start + 7 && day >= creationDay) {
                    completed += total;
                }
            }

            const expected: number =
                start === weekStart(creationDay) ? 0 : frequency.timesPerPeriod;

            weeks.push({ weekStart: localDay(start), ...counts(expected, completed) });
        }

        return { days, weeks };
    }

    for (let day: number = Math.max(firstDay, creationDay); day <= lastDay; day += 1) {
        let expected: number = frequency.timesPerPeriod;

        if (frequency.period === 'WEEKLY') {
            const position: number = selectedDays.indexOf(weekdays[weekdayIndex(day)]);

            expected = 0;

            if (position >= 0) {
                expected = Math.floor(frequency.timesPerPeriod / selectedDays.length);

                if (position < frequency.timesPerPeriod % selectedDays.length) {
                    expected += 1;
                }
            }
        }

        const date: string = localDay(day);

        days.push({ localDay: date, ...counts(expected, input.completedByDay[date] ?? 0) });
    }

    return { days, weeks };
}
