import { hasCivilDateFormat, isValidCivilDate } from './civil-date';

describe('Civil date utilities', () => {
    it.each(['0001-01-01', '9999-12-31', '2024-02-29', '2000-02-29', '2099-12-31', '2026-04-30'])(
        'accepts valid civil date %s independently of today',
        (value: string) => {
            expect(hasCivilDateFormat(value)).toBe(true);
            expect(isValidCivilDate(value)).toBe(true);
        },
    );

    it.each([
        '0000-01-01',
        '1900-02-29',
        '2026-02-29',
        '2026-04-31',
        '2026-00-01',
        '2026-13-01',
        '2026-01-00',
        '2026-01-32',
    ])('distinguishes valid format from invalid calendar %s', (value: string) => {
        expect(hasCivilDateFormat(value)).toBe(true);
        expect(isValidCivilDate(value)).toBe(false);
    });

    it.each([
        '10000-01-01',
        '2026-1-01',
        '2026-01',
        '2026-01-01T00:00:00Z',
        ' 2026-01-01',
        '2026-01-01 ',
        '2026-01-01\n',
        '2026-01-01\r',
        '',
        null,
        undefined,
        1,
        {},
    ])('rejects nonexact format %s without coercion', (value: unknown) => {
        expect(hasCivilDateFormat(value)).toBe(false);
        expect(isValidCivilDate(value as string)).toBe(false);
    });
});
