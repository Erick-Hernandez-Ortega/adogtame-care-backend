import { MedicationDate } from './medication-date';

describe('MedicationDate', () => {
    it.each(['0001-01-01', '9999-12-31', '2024-02-29', '2000-02-29', '2099-12-31'])(
        'accepts a complete civil date %s without consulting today',
        (value: string) => {
            expect(MedicationDate.from(value).value).toBe(value);
        },
    );

    it.each([
        '0000-01-01',
        '10000-01-01',
        '2026-02-29',
        '1900-02-29',
        '2026-04-31',
        '2026-00-01',
        '2026-13-01',
        '2026-01-00',
        '2026-01-32',
        '2026-1-01',
        '2026-01',
        '2026-01-01T00:00:00Z',
        '2026-01-01\n',
        '2026-01-01\r',
        ' 2026-01-01 ',
        '',
        '\n',
        1,
        null,
        {},
    ])('rejects invalid civil date %s', (value: unknown) => {
        expect(() => MedicationDate.from(value as string)).toThrow();
    });
});

describe('MedicationDate exact shared format', () => {
    it.each(['2026-10-10\n', '2026-10-10\r', '2026-10-10 ', ' 2026-10-10'])(
        'rejects additional characters in %s with the original format error',
        (value: string) => {
            expect(() => MedicationDate.from(value)).toThrow(
                new TypeError('Medication date must use the YYYY-MM-DD format'),
            );
        },
    );
});
