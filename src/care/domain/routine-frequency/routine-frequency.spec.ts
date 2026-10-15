import { RoutineFrequency, RoutineFrequencyInput, Weekday } from './routine-frequency';

describe('RoutineFrequency', () => {
    it.each(['DAILY', 'WEEKLY'])('accepts %s without optional suggestions', (period: string) => {
        expect(RoutineFrequency.from({ period, timesPerPeriod: 1 })).toMatchObject({
            period,
            timesPerPeriod: 1,
            suggestedTimes: [],
            weekdays: [],
        });
        expect(
            RoutineFrequency.from({
                period,
                timesPerPeriod: 1,
                suggestedTimes: null,
                weekdays: null,
            }),
        ).toMatchObject({ suggestedTimes: [], weekdays: [] });
    });

    it('retains local times and weekly days independently of the target count', () => {
        expect(
            RoutineFrequency.from({
                period: 'WEEKLY',
                timesPerPeriod: 3,
                suggestedTimes: ['00:00', '23:59'],
                weekdays: Object.values(Weekday),
            }),
        ).toMatchObject({
            timesPerPeriod: 3,
            suggestedTimes: ['00:00', '23:59'],
            weekdays: Object.values(Weekday),
        });
        expect(
            RoutineFrequency.from({ period: 'DAILY', timesPerPeriod: Number.MAX_SAFE_INTEGER })
                .timesPerPeriod,
        ).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('accepts 24 distinct times and all seven distinct weekdays', () => {
        const suggestedTimes: string[] = Array.from(
            { length: 24 },
            (_, hour: number): string => `${String(hour).padStart(2, '0')}:00`,
        );

        expect(
            RoutineFrequency.from({
                period: 'WEEKLY',
                timesPerPeriod: 1,
                suggestedTimes,
                weekdays: Object.values(Weekday),
            }).suggestedTimes,
        ).toEqual(suggestedTimes);
    });

    it.each([
        { suggestedTimes: ['08:00', '08:00'] },
        { weekdays: ['MONDAY', 'MONDAY'] },
        {
            suggestedTimes: Array.from(
                { length: 25 },
                (_, minute: number): string => `08:${String(minute).padStart(2, '0')}`,
            ),
        },
        { weekdays: [...Object.values(Weekday), 'MONDAY'] },
    ])('rejects duplicate or excessive suggestions %j', (suggestions) => {
        expect(() =>
            RoutineFrequency.from({ period: 'WEEKLY', timesPerPeriod: 1, ...suggestions }),
        ).toThrow(TypeError);
    });

    it('defensively copies and freezes suggestions', () => {
        const suggestedTimes: string[] = ['08:00'];
        const weekdays: string[] = ['MONDAY'];
        const frequency: RoutineFrequency = RoutineFrequency.from({
            period: 'WEEKLY',
            timesPerPeriod: 1,
            suggestedTimes,
            weekdays,
        });

        suggestedTimes[0] = '25:00';
        weekdays.push('INVALID');

        expect(frequency.suggestedTimes).toEqual(['08:00']);
        expect(frequency.weekdays).toEqual(['MONDAY']);
        expect(() => (frequency.suggestedTimes as string[]).push('09:00')).toThrow(TypeError);
        expect(() => (frequency.weekdays as string[]).push('TUESDAY')).toThrow(TypeError);
    });

    it.each([0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null])(
        'rejects invalid target count %s',
        (timesPerPeriod: unknown) => {
            expect(() =>
                RoutineFrequency.from({
                    period: 'DAILY',
                    timesPerPeriod: timesPerPeriod as number,
                }),
            ).toThrow(RangeError);
        },
    );

    it.each([
        '24:00',
        '12:60',
        '8:00',
        '08:0',
        '08:00:00',
        '08:00Z',
        ' 08:00',
        '08:00\n',
        '',
        null,
        800,
    ])('rejects invalid local time %s', (suggestedTime: unknown) => {
        expect(() =>
            RoutineFrequency.from({
                period: 'DAILY',
                timesPerPeriod: 1,
                suggestedTimes: [suggestedTime as string],
            }),
        ).toThrow(TypeError);
    });

    it.each([
        { period: 'MONTHLY', timesPerPeriod: 1 },
        { period: 'daily', timesPerPeriod: 1 },
        { period: 'DAILY', timesPerPeriod: 1, weekdays: ['MONDAY'] },
        { period: 'WEEKLY', timesPerPeriod: 1, weekdays: ['Monday'] },
        { period: 'WEEKLY', timesPerPeriod: 1, weekdays: [1] },
        { period: 'DAILY', timesPerPeriod: 1, suggestedTimes: '08:00' },
        { period: 'WEEKLY', timesPerPeriod: 1, weekdays: 'MONDAY' },
        null,
        undefined,
    ])('rejects malformed frequency %s', (input: unknown) => {
        expect(() => RoutineFrequency.from(input as RoutineFrequencyInput)).toThrow(TypeError);
    });
});
