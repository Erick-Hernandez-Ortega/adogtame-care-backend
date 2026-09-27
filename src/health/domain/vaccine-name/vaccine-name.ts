export class VaccineName {
  private constructor(readonly value: string) {}

  static from(value: string): VaccineName {
    if (typeof value !== 'string') {
      throw new TypeError('Vaccine name must be a string');
    }
    const normalizedValue: string = value.trim();
    if (normalizedValue.length === 0) {
      throw new TypeError('Vaccine name cannot be empty');
    }
    if (Array.from(normalizedValue).length > 255) {
      throw new RangeError('Vaccine name must have at most 255 characters');
    }
    return new VaccineName(normalizedValue);
  }
}
