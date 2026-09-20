import { BirthDateAccuracy, BirthInformation } from './birth-information';

describe('BirthInformation', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('represents an exact birth date', () => {
    const birthInformation: BirthInformation =
      BirthInformation.exact('2021-06-14');

    expect(birthInformation.date).toBe('2021-06-14');
    expect(birthInformation.accuracy).toBe(BirthDateAccuracy.EXACT);
  });

  it('represents an approximate birth date', () => {
    const birthInformation: BirthInformation =
      BirthInformation.approximate('2020-01-01');

    expect(birthInformation.date).toBe('2020-01-01');
    expect(birthInformation.accuracy).toBe(BirthDateAccuracy.APPROXIMATE);
  });

  it.each(['2020/01/01', '01-01-2020', '2020-1-1'])(
    'rejects a birth date with an invalid format: %s',
    (date: string) => {
      expect(() => BirthInformation.exact(date)).toThrow(
        'Birth date must use the YYYY-MM-DD format',
      );
    },
  );

  it.each(['2021-02-29', '2020-13-01', '2020-04-31', '0000-01-01'])(
    'rejects an invalid calendar date: %s',
    (date: string) => {
      expect(() => BirthInformation.approximate(date)).toThrow(
        'Birth date must be a valid calendar date',
      );
    },
  );

  it('accepts February 29 in a leap year', () => {
    expect(BirthInformation.exact('2020-02-29').date).toBe('2020-02-29');
  });

  it('rejects a future birth date', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-20T12:00:00.000Z'));

    expect(() => BirthInformation.exact('2026-09-21')).toThrow(
      'Birth date cannot be in the future',
    );
  });

  it('accepts the current UTC date', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-20T23:59:59.000Z'));

    expect(BirthInformation.exact('2026-09-20').date).toBe('2026-09-20');
  });
});
