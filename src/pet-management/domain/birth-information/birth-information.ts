import { hasCivilDateFormat, isValidCivilDate } from '../../../shared/domain/civil-date';
import type { BirthDateAccuracy as BirthDateAccuracyType } from './birth-information.types';

export const BirthDateAccuracy = {
    EXACT: 'EXACT',
    APPROXIMATE: 'APPROXIMATE',
} as const satisfies Record<string, BirthDateAccuracyType>;

export class BirthInformation {
    private constructor(
        readonly date: string,
        readonly accuracy: BirthDateAccuracyType,
    ) {}

    static exact(date: string): BirthInformation {
        return BirthInformation.create(date, BirthDateAccuracy.EXACT);
    }

    static approximate(date: string): BirthInformation {
        return BirthInformation.create(date, BirthDateAccuracy.APPROXIMATE);
    }

    private static create(date: string, accuracy: BirthDateAccuracyType): BirthInformation {
        BirthInformation.assertValidDate(date);

        return new BirthInformation(date, accuracy);
    }

    private static assertValidDate(date: string): void {
        if (!hasCivilDateFormat(date)) {
            throw new TypeError('Birth date must use the YYYY-MM-DD format');
        }

        if (!isValidCivilDate(date)) {
            throw new RangeError('Birth date must be a valid calendar date');
        }

        if (date > BirthInformation.currentUtcDate()) {
            throw new RangeError('Birth date cannot be in the future');
        }
    }

    // ! Warning this new Date in server, considerer alternatives
    private static currentUtcDate(): string {
        return new Date().toISOString().slice(0, 10);
    }
}
