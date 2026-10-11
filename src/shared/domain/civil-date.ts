const CIVIL_DATE_PATTERN: RegExp = /^(\d{4})-(\d{2})-(\d{2})$/;

export function hasCivilDateFormat(value: unknown): value is string {
    return typeof value === 'string' && value.length === 10 && CIVIL_DATE_PATTERN.test(value);
}

export function isValidCivilDate(value: string): boolean {
    if (!hasCivilDateFormat(value)) {
        return false;
    }

    const year: number = Number(value.slice(0, 4));
    const month: number = Number(value.slice(5, 7));
    const day: number = Number(value.slice(8, 10));

    if (year < 1 || month < 1 || month > 12 || day < 1) {
        return false;
    }

    const isLeapYear: boolean = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
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
