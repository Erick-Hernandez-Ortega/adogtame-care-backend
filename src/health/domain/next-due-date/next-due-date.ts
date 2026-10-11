import { hasCivilDateFormat, isValidCivilDate } from '../../../shared/domain/civil-date';

export class NextDueDate {
    private constructor(readonly value: string) {}

    static from(value: string): NextDueDate {
        if (!hasCivilDateFormat(value)) {
            throw new TypeError('Next due date must use the YYYY-MM-DD format');
        }

        if (!isValidCivilDate(value)) {
            throw new RangeError('Next due date must be a valid calendar date');
        }

        return new NextDueDate(value);
    }
}
