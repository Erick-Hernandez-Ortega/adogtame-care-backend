import argon2, { verify } from 'argon2';
import { PasswordHash } from '../../domain/password-hash/password-hash';
import { Argon2idPasswordHasher } from './argon2id-password-hasher';

describe('Argon2idPasswordHasher', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('uses one fixed valid dummy hash with the same parameters as new credentials', async () => {
        const passwordHasher = new Argon2idPasswordHasher();
        const passwordHash: PasswordHash = await passwordHasher.hash('a secure password');
        const verifySpy = jest.spyOn(argon2, 'verify');
        const hashSpy = jest.spyOn(argon2, 'hash');

        await expect(passwordHasher.verify('first attempt', null)).resolves.toBe(false);
        await expect(passwordHasher.verify('second attempt', null)).resolves.toBe(false);

        expect(verifySpy).toHaveBeenCalledTimes(2);
        const dummyHash: string = verifySpy.mock.calls[0][0];

        expect(verifySpy).toHaveBeenNthCalledWith(1, dummyHash, 'first attempt');
        expect(verifySpy).toHaveBeenNthCalledWith(2, dummyHash, 'second attempt');
        expect(hashSpy).not.toHaveBeenCalled();
        expect(dummyHash.split('$').slice(0, 4)).toEqual(passwordHash.value.split('$').slice(0, 4));
        expect(Buffer.from(dummyHash.split('$')[4], 'base64')).toHaveLength(16);
        expect(Buffer.from(dummyHash.split('$')[5], 'base64')).toHaveLength(32);
    });

    it('creates an Argon2id hash that verifies the plaintext password', async () => {
        const passwordHasher = new Argon2idPasswordHasher();
        const plaintextPassword: string = 'a secure password';

        const passwordHash: PasswordHash = await passwordHasher.hash(plaintextPassword);

        expect(passwordHash.value).toMatch(/^\$argon2id\$/);
        expect(passwordHash.value).not.toBe(plaintextPassword);
        await expect(verify(passwordHash.value, plaintextPassword)).resolves.toBe(true);
        await expect(verify(passwordHash.value, 'a different password')).resolves.toBe(false);
        await expect(passwordHasher.verify(plaintextPassword, passwordHash)).resolves.toBe(true);
        await expect(passwordHasher.verify('a different password', passwordHash)).resolves.toBe(
            false,
        );
    });
});
