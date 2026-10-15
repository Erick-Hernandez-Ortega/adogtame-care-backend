import { hasCivilDateFormat, isValidCivilDate } from '../../../shared/domain/civil-date';

export class VisitDate {
    private constructor(readonly value: string) {}

    static from(value: string, today: string): VisitDate {
        const date: VisitDate = VisitDate.reconstitute(value);

        if (date.value > today) {
            throw new RangeError('Visit date cannot be in the future');
        }

        return date;
    }

    static reconstitute(value: string): VisitDate {
        if (!hasCivilDateFormat(value)) {
            throw new TypeError('Visit date must use the YYYY-MM-DD format');
        }

        if (!isValidCivilDate(value)) {
            throw new RangeError('Visit date must be a valid calendar date');
        }

        return new VisitDate(value);
    }
}
