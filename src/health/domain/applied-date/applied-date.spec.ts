import { AppliedDate } from './applied-date';

describe('AppliedDate', () => {
    it('accepts past and current calendar days', () => {
        expect(AppliedDate.from('2024-02-29', '2026-09-27').value).toBe('2024-02-29');
        expect(AppliedDate.from('2026-09-27', '2026-09-27').value).toBe('2026-09-27');
    });

    it.each(['2026-09-28', '2026-02-29', '2026-13-01', '2026-09-31', '2026-9-1'])(
        'rejects invalid or future date %s',
        (value) => {
            expect(() => AppliedDate.from(value, '2026-09-27')).toThrow();
        },
    );
});

describe('AppliedDate exact shared format', () => {
    it.each(['2026-10-10\n', '2026-10-10\r', '2026-10-10 ', ' 2026-10-10'])(
        'rejects additional characters in %s with the original format error',
        (value: string) => {
            expect(() => AppliedDate.from(value, '2026-10-11')).toThrow(
                new TypeError('Applied date must use the YYYY-MM-DD format'),
            );
        },
    );
});
