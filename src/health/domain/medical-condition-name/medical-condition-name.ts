export class MedicalConditionName {
    private constructor(readonly value: string) {}

    static from(value: string): MedicalConditionName {
        if (typeof value !== 'string') {
            throw new TypeError('Medical condition name must be a string');
        }

        const normalizedValue: string = value.trim();

        if (normalizedValue.length === 0) {
            throw new TypeError('Medical condition name cannot be empty');
        }

        if (Array.from(normalizedValue).length > 255) {
            throw new RangeError('Medical condition name must have at most 255 characters');
        }

        return new MedicalConditionName(normalizedValue);
    }
}
