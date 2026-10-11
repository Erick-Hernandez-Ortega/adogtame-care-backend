import { hasCivilDateFormat, isValidCivilDate } from '../../../shared/domain/civil-date';

export class DiagnosedDate {
    private constructor(readonly value: string) {}

    static from(value: string, today: string): DiagnosedDate {
        const date: DiagnosedDate = DiagnosedDate.reconstitute(value);

        if (date.value > today) {
            throw new RangeError('Diagnosed date cannot be in the future');
        }

        return date;
    }

    static reconstitute(value: string): DiagnosedDate {
        if (!hasCivilDateFormat(value)) {
            throw new TypeError('Diagnosed date must use the YYYY-MM-DD format');
        }

        if (!isValidCivilDate(value)) {
            throw new RangeError('Diagnosed date must be a valid calendar date');
        }

        return new DiagnosedDate(value);
    }
}
