export class PasswordHash {
  private constructor(readonly value: string) {}

  static from(value: string): PasswordHash {
    if (value.trim().length === 0) {
      throw new TypeError('Password hash cannot be empty');
    }

    return new PasswordHash(value);
  }
}
