import { isValidVaccinationDate } from '../applied-date/applied-date';

export class NextDueDate {
    private constructor(readonly value: string) {}

    static from(value: string): NextDueDate {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            throw new TypeError('Next due date must use the YYYY-MM-DD format');
        }

        if (!isValidVaccinationDate(value)) {
            throw new RangeError('Next due date must be a valid calendar date');
        }

        return new NextDueDate(value);
    }
}
