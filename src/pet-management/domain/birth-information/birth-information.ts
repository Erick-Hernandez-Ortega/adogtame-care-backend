import type { BirthDateAccuracy as BirthDateAccuracyType } from './birth-information.types';

export const BirthDateAccuracy = {
  EXACT: 'EXACT',
  APPROXIMATE: 'APPROXIMATE',
} as const satisfies Record<string, BirthDateAccuracyType>;

const ISO_DATE_PATTERN: RegExp = /^(\d{4})-(\d{2})-(\d{2})$/;

export class BirthInformation {
  private constructor(
    readonly date: string,
    readonly accuracy: BirthDateAccuracyType,
  ) {}

  static exact(date: string): BirthInformation {
    return BirthInformation.create(date, BirthDateAccuracy.EXACT);
  }

  static approximate(date: string): BirthInformation {
    return BirthInformation.create(date, BirthDateAccuracy.APPROXIMATE);
  }

  private static create(
    date: string,
    accuracy: BirthDateAccuracyType,
  ): BirthInformation {
    BirthInformation.assertValidDate(date);

    return new BirthInformation(date, accuracy);
  }

  private static assertValidDate(date: string): void {
    const match: RegExpExecArray | null = ISO_DATE_PATTERN.exec(date);

    if (match === null) {
      throw new TypeError('Birth date must use the YYYY-MM-DD format');
    }

    const year: number = Number(match[1]);
    const month: number = Number(match[2]);
    const day: number = Number(match[3]);

    if (!BirthInformation.isValidCalendarDate(year, month, day)) {
      throw new RangeError('Birth date must be a valid calendar date');
    }

    if (date > BirthInformation.currentUtcDate()) {
      throw new RangeError('Birth date cannot be in the future');
    }
  }

  private static isValidCalendarDate(
    year: number,
    month: number,
    day: number,
  ): boolean {
    if (year < 1 || month < 1 || month > 12 || day < 1) {
      return false;
    }

    const daysByMonth: readonly number[] = [
      31,
      BirthInformation.isLeapYear(year) ? 29 : 28,
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

  private static isLeapYear(year: number): boolean {
    return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
  }

  // ! Warning this new Date in server, considerer alternatives
  private static currentUtcDate(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
