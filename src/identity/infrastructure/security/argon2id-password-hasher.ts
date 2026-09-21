import { Injectable } from '@nestjs/common';
import { argon2id, hash } from 'argon2';
import type { PasswordHasher } from '../../application/security/password-hasher';
import { PasswordHash } from '../../domain/password-hash/password-hash';

@Injectable()
export class Argon2idPasswordHasher implements PasswordHasher {
  async hash(plaintextPassword: string): Promise<PasswordHash> {
    const encodedHash: string = await hash(plaintextPassword, {
      type: argon2id,
    });

    return PasswordHash.from(encodedHash);
  }
}
