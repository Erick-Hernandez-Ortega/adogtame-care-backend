import type { INestApplicationContext } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { AuthenticateAccount } from '../../src/identity/application/authenticate-account/authenticate-account';
import { InvalidCredentialsError } from '../../src/identity/application/authenticate-account/authenticate-account.errors';
import type { PasswordHash } from '../../src/identity/domain/password-hash/password-hash';
import { RegisterAccount } from '../../src/identity/application/register-account/register-account';
import { accounts } from '../../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { Argon2idPasswordHasher } from '../../src/identity/infrastructure/security/argon2id-password-hasher';
import { DatabaseService } from '../../src/infrastructure/database/database.service';

class ObservedPasswordHasher extends Argon2idPasswordHasher {
    readonly verifiedHashes: Array<PasswordHash | null> = [];

    override verify(
        plaintextPassword: string,
        passwordHash: PasswordHash | null,
    ): Promise<boolean> {
        this.verifiedHashes.push(passwordHash);

        return super.verify(plaintextPassword, passwordHash);
    }
}

describe('AuthenticateAccount (integration)', () => {
    let application: INestApplicationContext;
    let databaseService: DatabaseService;
    let authenticateAccount: AuthenticateAccount;
    let registerAccount: RegisterAccount;
    let passwordHasher: ObservedPasswordHasher;

    beforeAll(async () => {
        passwordHasher = new ObservedPasswordHasher();
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        })
            .overrideProvider(Argon2idPasswordHasher)
            .useValue(passwordHasher)
            .compile();

        application = moduleFixture;
        databaseService = application.get(DatabaseService);
        authenticateAccount = application.get(AuthenticateAccount);
        registerAccount = application.get(RegisterAccount);
    });

    afterAll(async () => {
        await application.close();
    });

    it('verifies both absent and persisted credentials through the real hasher without changing accounts', async () => {
        const email: string = `login-work-${randomUUID()}@example.com`;
        const missingEmail: string = `missing-login-${randomUUID()}@example.com`;
        const password: string = 'a secure password';

        try {
            await registerAccount.execute({ email, password });
            const [originalAccount] = await databaseService.connection
                .select()
                .from(accounts)
                .where(eq(accounts.email, email));

            await expect(
                authenticateAccount.execute({ email: missingEmail, password: 'wrong password' }),
            ).rejects.toEqual(new InvalidCredentialsError());
            await expect(
                authenticateAccount.execute({ email, password: 'wrong password' }),
            ).rejects.toEqual(new InvalidCredentialsError());
            await expect(authenticateAccount.execute({ email, password })).resolves.toEqual({
                accessToken: expect.any(String) as string,
            });

            expect(passwordHasher.verifiedHashes).toHaveLength(3);
            expect(passwordHasher.verifiedHashes[0]).toBeNull();
            expect(passwordHasher.verifiedHashes[1]?.value).toBe(originalAccount.passwordHash);
            expect(passwordHasher.verifiedHashes[2]?.value).toBe(originalAccount.passwordHash);

            const savedAccounts = await databaseService.connection
                .select()
                .from(accounts)
                .where(eq(accounts.email, email));
            const missingAccounts = await databaseService.connection
                .select()
                .from(accounts)
                .where(eq(accounts.email, missingEmail));

            expect(savedAccounts).toEqual([originalAccount]);
            expect(missingAccounts).toEqual([]);
        } finally {
            await databaseService.connection.delete(accounts).where(eq(accounts.email, email));
        }
    });
});
