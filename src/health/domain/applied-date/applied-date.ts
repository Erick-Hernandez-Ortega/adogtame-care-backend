const ISO_DATE_PATTERN: RegExp = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidVaccinationDate(value: string): boolean {
  const match: RegExpExecArray | null = ISO_DATE_PATTERN.exec(value);
  if (match === null) return false;
  const year: number = Number(match[1]);
  const month: number = Number(match[2]);
  const day: number = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const isLeapYear: boolean =
    year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
  const daysByMonth: readonly number[] = [
    31,
    isLeapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysByMonth[month - 1];
}

export class AppliedDate {
  private constructor(readonly value: string) {}

  static from(value: string, today: string): AppliedDate {
    if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
      throw new TypeError('Applied date must use the YYYY-MM-DD format');
    }
    if (!isValidVaccinationDate(value)) {
      throw new RangeError('Applied date must be a valid calendar date');
    }
    if (value > today) {
      throw new RangeError('Applied date cannot be in the future');
    }
    return new AppliedDate(value);
  }
}
