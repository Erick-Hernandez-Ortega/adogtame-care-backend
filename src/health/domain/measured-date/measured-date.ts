import { hasCivilDateFormat, isValidCivilDate } from '../../../shared/domain/civil-date';

export class MeasuredDate {
    private constructor(readonly value: string) {}

    static from(value: string, today: string): MeasuredDate {
        if (!hasCivilDateFormat(value)) {
            throw new TypeError('Measured date must use the YYYY-MM-DD format');
        }

        if (!isValidCivilDate(value)) {
            throw new RangeError('Measured date must be a valid calendar date');
        }

        if (value > today) {
            throw new RangeError('Measured date cannot be in the future');
        }

        return new MeasuredDate(value);
    }
}
