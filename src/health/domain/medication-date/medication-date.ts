const ISO_DATE_PATTERN: RegExp = /^(\d{4})-(\d{2})-(\d{2})$/;

export class MedicationDate {
    private constructor(readonly value: string) {}

    static from(value: string): MedicationDate {
        if (typeof value !== 'string' || value.length !== 10) {
            throw new TypeError('Medication date must use the YYYY-MM-DD format');
        }

        const match: RegExpExecArray | null = ISO_DATE_PATTERN.exec(value);

        if (match === null) {
            throw new TypeError('Medication date must use the YYYY-MM-DD format');
        }

        const year: number = Number(match[1]);
        const month: number = Number(match[2]);
        const day: number = Number(match[3]);
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

        if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysByMonth[month - 1]) {
            throw new RangeError('Medication date must be a valid calendar date');
        }

        return new MedicationDate(value);
    }
}
