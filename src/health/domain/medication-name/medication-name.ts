export class MedicationName {
    private constructor(readonly value: string) {}

    static from(value: string): MedicationName {
        if (typeof value !== 'string') {
            throw new TypeError('Medication name must be a string');
        }

        const normalizedValue: string = value.trim();

        if (normalizedValue.length === 0) {
            throw new TypeError('Medication name cannot be empty');
        }

        if (Array.from(normalizedValue).length > 255) {
            throw new RangeError('Medication name must have at most 255 characters');
        }

        return new MedicationName(normalizedValue);
    }
}
