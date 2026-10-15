import { ActivityCompletedAt } from './activity-completed-at';

describe('ActivityCompletedAt', () => {
    const now: Date = new Date('2026-10-15T12:00:00.123Z');

    it('accepts now, past instants and normalizes fractional precision', () => {
        expect(ActivityCompletedAt.from(now.toISOString(), now).value).toBe(now.toISOString());
        expect(ActivityCompletedAt.from('2020-02-29T00:00:00Z', now).value).toBe(
            '2020-02-29T00:00:00.000Z',
        );
        expect(ActivityCompletedAt.from('2020-02-29T00:00:00.1Z', now).value).toBe(
            '2020-02-29T00:00:00.100Z',
        );
    });

    it('rejects even one millisecond in the future but reconstitutes without consulting current time', () => {
        expect(() => ActivityCompletedAt.from('2026-10-15T12:00:00.124Z', now)).toThrow(RangeError);
        expect(ActivityCompletedAt.reconstitute('9999-12-31T23:59:59.999Z').value).toBe(
            '9999-12-31T23:59:59.999Z',
        );
    });

    it.each([
        '2025-02-29T00:00:00Z',
        '0000-01-01T00:00:00Z',
        '2026-04-31T00:00:00Z',
        '2020-01-01',
        '2020-01-01T24:00:00Z',
        '2020-01-01T00:00:60Z',
        '2020-01-01T00:00:00+00:00',
        '2020-01-01T00:00:00Z\n',
        '2020-01-01T00:00:00.1234Z',
    ])('rejects malformed UTC instant %s', (value: string) => {
        expect(() => ActivityCompletedAt.from(value, now)).toThrow(TypeError);
    });
});
