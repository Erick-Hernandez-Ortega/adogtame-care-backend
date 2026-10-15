import { Injectable } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';
import type { PasswordHasher } from '../../application/security/password-hasher';
import { PasswordHash } from '../../domain/password-hash/password-hash';

// Precomputed once with the same Argon2id defaults as hash(); never hash per login.
const DUMMY_PASSWORD_HASH: string =
    '$argon2id$v=19$m=65536,p=4,t=3$jr0UEFcfHz1G3ukCkNBhkw$jbwRqYNTnPrRL22vVlO922AryqAoyZKYw8cNPIL0pBI';

@Injectable()
export class Argon2idPasswordHasher implements PasswordHasher {
    async hash(plaintextPassword: string): Promise<PasswordHash> {
        const encodedHash: string = await hash(plaintextPassword, {
            type: argon2id,
        });

        return PasswordHash.from(encodedHash);
    }

    async verify(plaintextPassword: string, passwordHash: PasswordHash | null): Promise<boolean> {
        const isPasswordValid: boolean = await verify(
            passwordHash?.value ?? DUMMY_PASSWORD_HASH,
            plaintextPassword,
        );

        return passwordHash !== null && isPasswordValid;
    }
}
