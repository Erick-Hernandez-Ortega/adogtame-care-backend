import { verify } from 'argon2';
import { PasswordHash } from '../../domain/password-hash/password-hash';
import { Argon2idPasswordHasher } from './argon2id-password-hasher';

describe('Argon2idPasswordHasher', () => {
  it('creates an Argon2id hash that verifies the plaintext password', async () => {
    const passwordHasher = new Argon2idPasswordHasher();
    const plaintextPassword: string = 'a secure password';

    const passwordHash: PasswordHash =
      await passwordHasher.hash(plaintextPassword);

    expect(passwordHash.value).toMatch(/^\$argon2id\$/);
    expect(passwordHash.value).not.toBe(plaintextPassword);
    await expect(verify(passwordHash.value, plaintextPassword)).resolves.toBe(
      true,
    );
    await expect(
      verify(passwordHash.value, 'a different password'),
    ).resolves.toBe(false);
  });
});
