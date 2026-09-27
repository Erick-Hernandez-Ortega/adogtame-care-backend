const DECIMAL_PATTERN: RegExp = /^(\d+)(?:\.(\d+))?$/;

export class Weight {
  private constructor(readonly kilograms: string) {}

  static fromKilograms(value: string): Weight {
    const match: RegExpExecArray | null = DECIMAL_PATTERN.exec(value);
    if (match === null) {
      throw new TypeError('Weight must be a decimal string');
    }

    const fractionalDigits: string = match[2] ?? '';
    if (fractionalDigits.length > 4) {
      throw new RangeError('Weight must have at most four decimal places');
    }

    const wholeDigits: string = match[1].replace(/^0+(?=\d)/, '');
    const normalizedFraction: string = fractionalDigits.replace(/0+$/, '');
    if (wholeDigits === '0' && normalizedFraction.length === 0) {
      throw new RangeError('Weight must be greater than zero');
    }

    const kilograms: string =
      normalizedFraction.length === 0
        ? wholeDigits
        : `${wholeDigits}.${normalizedFraction}`;
    return new Weight(kilograms);
  }
}
