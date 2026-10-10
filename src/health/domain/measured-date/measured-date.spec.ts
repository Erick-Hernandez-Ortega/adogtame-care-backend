import { MeasuredDate } from './measured-date';

describe('MeasuredDate', () => {
    const today = '2026-09-26';

    it.each(['2026-09-26', '2026-01-10', '2024-02-29'])('accepts %s as a civil date', (date) => {
        expect(MeasuredDate.from(date, today).value).toBe(date);
    });

    it.each(['2026-02-29', '2026-13-01', '2026-04-31', '0000-01-01'])(
        'rejects invalid calendar date %s',
        (date) => {
            expect(() => MeasuredDate.from(date, today)).toThrow(
                'Measured date must be a valid calendar date',
            );
        },
    );

    it.each(['2026-9-26', '26-09-26', '2026-09-26T00:00:00Z'])(
        'rejects invalid format %s',
        (date) => {
            expect(() => MeasuredDate.from(date, today)).toThrow(
                'Measured date must use the YYYY-MM-DD format',
            );
        },
    );

    it('rejects a future date', () => {
        expect(() => MeasuredDate.from('2026-09-27', today)).toThrow(
            'Measured date cannot be in the future',
        );
    });
});
