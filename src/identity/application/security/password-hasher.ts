import type { PasswordHash } from '../../domain/password-hash/password-hash';

export const PASSWORD_HASHER: unique symbol = Symbol('PASSWORD_HASHER');

export interface PasswordHasher {
  hash(plaintextPassword: string): Promise<PasswordHash>;
  verify(
    plaintextPassword: string,
    passwordHash: PasswordHash,
  ): Promise<boolean>;
}
