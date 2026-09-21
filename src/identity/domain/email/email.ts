const EMAIL_FORMAT: RegExp = /^[^\s@]+@[^\s@]+$/;

export class Email {
  private constructor(readonly value: string) {}

  static from(value: string): Email {
    const normalizedValue: string = value.trim().toLowerCase();

    if (normalizedValue.length === 0) {
      throw new TypeError('Email cannot be empty');
    }

    if (!EMAIL_FORMAT.test(normalizedValue)) {
      throw new TypeError('Email format is invalid');
    }

    return new Email(normalizedValue);
  }
}
