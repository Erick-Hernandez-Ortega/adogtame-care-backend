export function normalizeRequiredText(value: string, label: string, maxLength: number): string {
    if (typeof value !== 'string') {
        throw new TypeError(`${label} must be a string`);
    }

    const normalizedValue: string = value.trim();

    if (normalizedValue.length === 0) {
        throw new TypeError(`${label} cannot be empty`);
    }

    if (Array.from(normalizedValue).length > maxLength) {
        throw new RangeError(`${label} must have at most ${maxLength} characters`);
    }

    return normalizedValue;
}
