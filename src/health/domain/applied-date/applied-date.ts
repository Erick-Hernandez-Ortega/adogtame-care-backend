import { hasCivilDateFormat, isValidCivilDate } from '../../../shared/domain/civil-date';

export class AppliedDate {
    private constructor(readonly value: string) {}

    static from(value: string, today: string): AppliedDate {
        if (!hasCivilDateFormat(value)) {
            throw new TypeError('Applied date must use the YYYY-MM-DD format');
        }

        if (!isValidCivilDate(value)) {
            throw new RangeError('Applied date must be a valid calendar date');
        }

        if (value > today) {
            throw new RangeError('Applied date cannot be in the future');
        }

        return new AppliedDate(value);
    }
}
