export class Allergen {
  private constructor(readonly value: string) {}

  static from(value: string): Allergen {
    if (typeof value !== 'string') {
      throw new TypeError('Allergen must be a string');
    }
    const normalizedValue: string = value.trim();
    if (normalizedValue.length === 0) {
      throw new TypeError('Allergen cannot be empty');
    }
    if (Array.from(normalizedValue).length > 255) {
      throw new RangeError('Allergen must have at most 255 characters');
    }
    return new Allergen(normalizedValue);
  }
}
