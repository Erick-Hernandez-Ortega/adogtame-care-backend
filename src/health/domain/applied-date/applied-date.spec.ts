import { AppliedDate } from './applied-date';

describe('AppliedDate', () => {
  it('accepts past and current calendar days', () => {
    expect(AppliedDate.from('2024-02-29', '2026-09-27').value).toBe(
      '2024-02-29',
    );
    expect(AppliedDate.from('2026-09-27', '2026-09-27').value).toBe(
      '2026-09-27',
    );
  });

  it.each(['2026-09-28', '2026-02-29', '2026-13-01', '2026-09-31', '2026-9-1'])(
    'rejects invalid or future date %s',
    (value) => {
      expect(() => AppliedDate.from(value, '2026-09-27')).toThrow();
    },
  );
});
