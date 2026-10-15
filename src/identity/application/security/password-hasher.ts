import type { PasswordHash } from '../../domain/password-hash/password-hash';

export const PASSWORD_HASHER: unique symbol = Symbol('PASSWORD_HASHER');

export interface PasswordHasher {
    hash(plaintextPassword: string): Promise<PasswordHash>;
    // An absent credential must perform equivalent verification work and return false.
    verify(plaintextPassword: string, passwordHash: PasswordHash | null): Promise<boolean>;
}
