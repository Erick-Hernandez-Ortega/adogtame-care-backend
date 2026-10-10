import { ResolvedDate } from './resolved-date';

describe('ResolvedDate', () => {
    it.each(['0001-01-01', '1900-02-28', '2000-02-29', '2024-02-29', '2026-03-14'])(
        'accepts past or current calendar date %s',
        (value: string) => {
            expect(ResolvedDate.from(value, '2026-03-14').value).toBe(value);
        },
    );
    it.each([
        '2026-03-15',
        '0000-01-01',
        '1900-02-29',
        '2026-02-29',
        '2026-04-31',
        '2026-00-01',
        '2026-13-01',
        '2026-01-00',
        '2026-01-32',
        '2026-3-14',
        '2026',
        '2026-03',
        '2026-03-14T00:00:00Z',
        ' 2026-03-14 ',
        '10000-01-01',
        '',
    ])('rejects invalid or future date %s', (value: string) => {
        expect(() => ResolvedDate.from(value, '2026-03-14')).toThrow();
    });
    it.each([null, undefined, 1, {}])('rejects non-string runtime date %s', (value: unknown) => {
        expect(() => ResolvedDate.from(value as string, '2026-03-14')).toThrow(TypeError);
    });
});

describe('ResolvedDate persisted reconstruction', () => {
    it('accepts historical dates independently of the current day', () => {
        expect(ResolvedDate.reconstitute('2027-01-01').value).toBe('2027-01-01');
        expect(() => ResolvedDate.from('2027-01-01', '2026-03-14')).toThrow(RangeError);
    });
    it.each(['2026', '2026-02-29', '0000-01-01', '2026-13-01'])(
        'rejects structurally invalid stored date %s',
        (value: string) => {
            expect(() => ResolvedDate.reconstitute(value)).toThrow();
        },
    );
});
