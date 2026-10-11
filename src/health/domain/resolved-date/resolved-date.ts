import { hasCivilDateFormat, isValidCivilDate } from '../../../shared/domain/civil-date';

export class ResolvedDate {
    private constructor(readonly value: string) {}

    static from(value: string, today: string): ResolvedDate {
        const date: ResolvedDate = ResolvedDate.reconstitute(value);

        if (date.value > today) {
            throw new RangeError('Resolved date cannot be in the future');
        }

        return date;
    }

    static reconstitute(value: string): ResolvedDate {
        if (!hasCivilDateFormat(value)) {
            throw new TypeError('Resolved date must use the YYYY-MM-DD format');
        }

        if (!isValidCivilDate(value)) {
            throw new RangeError('Resolved date must be a valid calendar date');
        }

        return new ResolvedDate(value);
    }
}
