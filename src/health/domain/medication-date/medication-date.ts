import { hasCivilDateFormat, isValidCivilDate } from '../../../shared/domain/civil-date';

export class MedicationDate {
    private constructor(readonly value: string) {}

    static from(value: string): MedicationDate {
        if (!hasCivilDateFormat(value)) {
            throw new TypeError('Medication date must use the YYYY-MM-DD format');
        }

        if (!isValidCivilDate(value)) {
            throw new RangeError('Medication date must be a valid calendar date');
        }

        return new MedicationDate(value);
    }
}
