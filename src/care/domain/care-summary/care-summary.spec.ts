import { summarizeRoutine, type RoutineSummaryInput } from './care-summary';
import { RoutineFrequency } from '../routine-frequency/routine-frequency';

function input(overrides: Partial<RoutineSummaryInput> = {}): RoutineSummaryInput {
    return {
        frequency: RoutineFrequency.from({ period: 'DAILY', timesPerPeriod: 2 }),
        createdLocalDay: '2026-03-03',
        completedByDay: { '2026-03-03': 1, '2026-03-04': 3 },
        ...overrides,
    };
}

describe('summarizeRoutine', () => {
    it('counts daily targets inclusively, omits precreation days and clamps missed at zero', () => {
        expect(summarizeRoutine(input(), '2026-03-01', '2026-03-05')).toEqual({
            days: [
                { localDay: '2026-03-03', expected: 2, completed: 1, missed: 1 },
                { localDay: '2026-03-04', expected: 2, completed: 3, missed: 0 },
                { localDay: '2026-03-05', expected: 2, completed: 0, missed: 2 },
            ],
            weeks: [],
        });
    });

    it.each([5, 2, 6])(
        'allocates %s weekly completions in ISO order regardless of suggestion order',
        (target: number) => {
            const result = summarizeRoutine(
                input({
                    createdLocalDay: '2026-03-01',
                    completedByDay: { '2026-03-03': 1 },
                    frequency: RoutineFrequency.from({
                        period: 'WEEKLY',
                        timesPerPeriod: target,
                        weekdays: ['SUNDAY', 'WEDNESDAY', 'MONDAY'],
                    }),
                }),
                '2026-03-02',
                '2026-03-08',
            );
            const floor: number = Math.floor(target / 3);
            const remainder: number = target % 3;

            expect(result.days.map((day): number => day.expected)).toEqual([
                floor + Number(remainder > 0),
                0,
                floor + Number(remainder > 1),
                0,
                0,
                0,
                floor,
            ]);
            expect(result.days[1]).toEqual({
                localDay: '2026-03-03',
                expected: 0,
                completed: 1,
                missed: 0,
            });
            expect(result.weeks).toEqual([]);
        },
    );

    it('reports whole ISO weeks at partial edges and zero expectation in the creation week', () => {
        expect(
            summarizeRoutine(
                input({
                    frequency: RoutineFrequency.from({ period: 'WEEKLY', timesPerPeriod: 4 }),
                    createdLocalDay: '2025-12-31',
                    completedByDay: {
                        '2025-12-29': 7,
                        '2026-01-01': 2,
                        '2026-01-05': 1,
                        '2026-01-11': 2,
                        '2026-01-12': 9,
                    },
                }),
                '2025-12-30',
                '2026-01-07',
            ),
        ).toEqual({
            days: [],
            weeks: [
                { weekStart: '2025-12-29', expected: 0, completed: 2, missed: 0 },
                { weekStart: '2026-01-05', expected: 4, completed: 3, missed: 1 },
            ],
        });
    });

    it('omits weeks before creation and starts counting the following Monday', () => {
        const result = summarizeRoutine(
            input({
                frequency: RoutineFrequency.from({ period: 'WEEKLY', timesPerPeriod: 1 }),
                createdLocalDay: '2026-03-08',
                completedByDay: {},
            }),
            '2026-02-23',
            '2026-03-09',
        );

        expect(result.weeks).toEqual([
            { weekStart: '2026-03-02', expected: 0, completed: 0, missed: 0 },
            { weekStart: '2026-03-09', expected: 1, completed: 0, missed: 1 },
        ]);
    });

    it('uses current frequency even for past days and ignores suggested times', () => {
        const original: RoutineSummaryInput = input();
        const corrected: RoutineSummaryInput = {
            ...original,
            frequency: RoutineFrequency.from({
                period: 'DAILY',
                timesPerPeriod: 5,
                suggestedTimes: ['23:59'],
            }),
        };

        expect(summarizeRoutine(corrected, '2026-03-03', '2026-03-03').days[0].expected).toBe(5);
        expect(original.frequency.timesPerPeriod).toBe(2);
    });

    it.each(['0001-01-01', '2024-02-29', '9999-12-31'])(
        'handles civil date boundary %s',
        (date: string) => {
            expect(
                summarizeRoutine(input({ createdLocalDay: date, completedByDay: {} }), date, date)
                    .days,
            ).toEqual([{ localDay: date, expected: 2, completed: 0, missed: 2 }]);
        },
    );
});
