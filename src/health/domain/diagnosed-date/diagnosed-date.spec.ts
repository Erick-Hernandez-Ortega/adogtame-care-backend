import { DiagnosedDate } from './diagnosed-date';

describe('DiagnosedDate', () => {
  it.each([
    '0001-01-01',
    '1900-02-28',
    '2000-02-29',
    '2024-02-29',
    '2026-03-14',
  ])('accepts past or current calendar date %s', (value: string) => {
    expect(DiagnosedDate.from(value, '2026-03-14').value).toBe(value);
  });
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
    expect(() => DiagnosedDate.from(value, '2026-03-14')).toThrow();
  });
  it.each([null, undefined, 1, {}])(
    'rejects non-string runtime date %s',
    (value: unknown) => {
      expect(() => DiagnosedDate.from(value as string, '2026-03-14')).toThrow(
        TypeError,
      );
    },
  );
});
