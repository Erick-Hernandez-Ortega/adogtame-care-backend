import { Account, AccountId } from '../../domain/account/account';
import { Email } from '../../domain/email/email';
import { PasswordHash } from '../../domain/password-hash/password-hash';
import type { AccountRepository } from '../persistence/account.repository';
import { SaveAccountOutcome } from '../persistence/account.repository';
import type { AccessTokenIssuer } from '../security/access-token-issuer';
import type { PasswordHasher } from '../security/password-hasher';
import { InvalidEmailError } from '../errors/invalid-email.error';
import { AuthenticateAccount } from './authenticate-account';
import { InvalidCredentialsError } from './authenticate-account.errors';
import type { AuthenticatedAccount } from './authenticate-account.types';

const ACCOUNT_ID: string = '018f3f4a-38d2-7b22-8b5d-6063e393d7c8';
const HASH_VALUE: string = '$argon2id$encoded-hash';

function createAccount(): Account {
  return Account.reconstitute({
    id: AccountId.from(ACCOUNT_ID),
    email: Email.from('erick@example.com'),
    passwordHash: PasswordHash.from(HASH_VALUE),
  });
}

class InMemoryAccountRepository implements AccountRepository {
  account: Account | null = createAccount();
  readonly searchedEmails: Email[] = [];

  save(): Promise<SaveAccountOutcome> {
    return Promise.resolve(SaveAccountOutcome.SAVED);
  }

  findByEmail(email: Email): Promise<Account | null> {
    this.searchedEmails.push(email);
    return Promise.resolve(this.account);
  }

  findById(): Promise<Account | null> {
    return Promise.resolve(this.account);
  }
}

class FakePasswordHasher implements PasswordHasher {
  isPasswordValid: boolean = true;
  readonly verifications: Array<{
    plaintextPassword: string;
    passwordHash: PasswordHash;
  }> = [];

  hash(): Promise<PasswordHash> {
    return Promise.resolve(PasswordHash.from(HASH_VALUE));
  }

  verify(
    plaintextPassword: string,
    passwordHash: PasswordHash,
  ): Promise<boolean> {
    this.verifications.push({ plaintextPassword, passwordHash });
    return Promise.resolve(this.isPasswordValid);
  }
}

class FakeAccessTokenIssuer implements AccessTokenIssuer {
  readonly accountIds: AccountId[] = [];

  issue(accountId: AccountId): Promise<string> {
    this.accountIds.push(accountId);
    return Promise.resolve('signed-access-token');
  }
}

describe('AuthenticateAccount', () => {
  it('normalizes the email, verifies the password, and issues an access token', async () => {
    const repository = new InMemoryAccountRepository();
    const passwordHasher = new FakePasswordHasher();
    const accessTokenIssuer = new FakeAccessTokenIssuer();
    const authenticateAccount = new AuthenticateAccount(
      repository,
      passwordHasher,
      accessTokenIssuer,
    );

    const result: AuthenticatedAccount = await authenticateAccount.execute({
      email: ' Erick@Example.COM ',
      password: 'any password length',
    });

    expect(repository.searchedEmails[0].value).toBe('erick@example.com');
    expect(passwordHasher.verifications).toEqual([
      {
        plaintextPassword: 'any password length',
        passwordHash: repository.account?.passwordHash,
      },
    ]);
    expect(accessTokenIssuer.accountIds).toEqual([repository.account?.id]);
    expect(result).toEqual({ accessToken: 'signed-access-token' });
    expect(result).not.toHaveProperty('email');
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('rejects an invalid email before querying the repository', async () => {
    const repository = new InMemoryAccountRepository();
    const authenticateAccount = new AuthenticateAccount(
      repository,
      new FakePasswordHasher(),
      new FakeAccessTokenIssuer(),
    );

    await expect(
      authenticateAccount.execute({ email: 'invalid', password: 'password' }),
    ).rejects.toThrow(InvalidEmailError);
    expect(repository.searchedEmails).toHaveLength(0);
  });

  it('returns invalid credentials without verifying when the account is absent', async () => {
    const repository = new InMemoryAccountRepository();
    repository.account = null;
    const passwordHasher = new FakePasswordHasher();
    const authenticateAccount = new AuthenticateAccount(
      repository,
      passwordHasher,
      new FakeAccessTokenIssuer(),
    );

    await expect(
      authenticateAccount.execute({
        email: 'missing@example.com',
        password: 'password',
      }),
    ).rejects.toEqual(new InvalidCredentialsError());
    expect(passwordHasher.verifications).toHaveLength(0);
  });

  it('returns invalid credentials and does not issue a token for a wrong password', async () => {
    const passwordHasher = new FakePasswordHasher();
    passwordHasher.isPasswordValid = false;
    const accessTokenIssuer = new FakeAccessTokenIssuer();
    const authenticateAccount = new AuthenticateAccount(
      new InMemoryAccountRepository(),
      passwordHasher,
      accessTokenIssuer,
    );

    await expect(
      authenticateAccount.execute({
        email: 'erick@example.com',
        password: 'wrong password',
      }),
    ).rejects.toEqual(new InvalidCredentialsError());
    expect(accessTokenIssuer.accountIds).toHaveLength(0);
  });
});
