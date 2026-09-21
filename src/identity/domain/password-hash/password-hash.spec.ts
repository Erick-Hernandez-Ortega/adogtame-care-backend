import { PasswordHash } from './password-hash';

describe('PasswordHash', () => {
  it('preserves the hash without normalization', () => {
    const value: string = ' $argon2id$encoded-hash ';

    expect(PasswordHash.from(value).value).toBe(value);
  });

  it.each(['', '   '])('rejects an empty hash: %p', (value: string) => {
    expect(() => PasswordHash.from(value)).toThrow(
      'Password hash cannot be empty',
    );
  });
});
