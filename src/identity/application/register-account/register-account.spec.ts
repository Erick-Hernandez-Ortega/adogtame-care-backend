import type { Account } from '../../domain/account/account';
import type { Email } from '../../domain/email/email';
import { PasswordHash } from '../../domain/password-hash/password-hash';
import {
  SaveAccountOutcome,
  type AccountRepository,
} from '../persistence/account.repository';
import type { PasswordHasher } from '../security/password-hasher';
import { InvalidEmailError } from '../errors/invalid-email.error';
import { RegisterAccount } from './register-account';
import {
  EmailAlreadyRegisteredError,
  InvalidPasswordError,
} from './register-account.errors';
import type { RegisteredAccount } from './register-account.types';

const HASH_VALUE: string = '$argon2id$encoded-hash';

class InMemoryAccountRepository implements AccountRepository {
  readonly savedAccounts: Account[] = [];
  outcome: SaveAccountOutcome = SaveAccountOutcome.SAVED;

  save(account: Account): Promise<SaveAccountOutcome> {
    this.savedAccounts.push(account);

    return Promise.resolve(this.outcome);
  }

  findByEmail(): Promise<Account | null> {
    return Promise.resolve(null);
  }
}

class FakePasswordHasher implements PasswordHasher {
  readonly receivedPasswords: string[] = [];

  hash(plaintextPassword: string): Promise<PasswordHash> {
    this.receivedPasswords.push(plaintextPassword);

    return Promise.resolve(PasswordHash.from(HASH_VALUE));
  }

  verify(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

describe('RegisterAccount', () => {
  it('hashes, registers, persists, and returns the public representation', async () => {
    const repository = new InMemoryAccountRepository();
    const passwordHasher = new FakePasswordHasher();
    const registerAccount = new RegisterAccount(repository, passwordHasher);
    const plaintextPassword: string = 'a secure password';

    const result: RegisteredAccount = await registerAccount.execute({
      email: ' Erick@Example.COM ',
      password: plaintextPassword,
    });

    expect(passwordHasher.receivedPasswords).toEqual([plaintextPassword]);
    expect(repository.savedAccounts).toHaveLength(1);
    expect(repository.savedAccounts[0].email.value).toBe('erick@example.com');
    expect(repository.savedAccounts[0].passwordHash.value).toBe(HASH_VALUE);
    expect(result).toEqual({
      id: repository.savedAccounts[0].id.value,
      email: 'erick@example.com',
    });
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('passwordHash');
  });

  it.each([12, 128])(
    'accepts a password containing %i Unicode code points',
    async (passwordLength: number) => {
      const repository = new InMemoryAccountRepository();
      const passwordHasher = new FakePasswordHasher();
      const registerAccount = new RegisterAccount(repository, passwordHasher);

      await expect(
        registerAccount.execute({
          email: 'erick@example.com',
          password: '🐕'.repeat(passwordLength),
        }),
      ).resolves.toBeDefined();
    },
  );

  it('does not hash or persist an invalid email', async () => {
    const repository = new InMemoryAccountRepository();
    const passwordHasher = new FakePasswordHasher();
    const registerAccount = new RegisterAccount(repository, passwordHasher);

    await expect(
      registerAccount.execute({
        email: 'invalid-email',
        password: 'a secure password',
      }),
    ).rejects.toThrow(InvalidEmailError);
    expect(passwordHasher.receivedPasswords).toHaveLength(0);
    expect(repository.savedAccounts).toHaveLength(0);
  });

  it.each([11, 129])(
    'does not hash or persist a password containing %i characters',
    async (passwordLength: number) => {
      const repository = new InMemoryAccountRepository();
      const passwordHasher = new FakePasswordHasher();
      const registerAccount = new RegisterAccount(repository, passwordHasher);

      await expect(
        registerAccount.execute({
          email: 'erick@example.com',
          password: 'a'.repeat(passwordLength),
        }),
      ).rejects.toThrow(InvalidPasswordError);
      expect(passwordHasher.receivedPasswords).toHaveLength(0);
      expect(repository.savedAccounts).toHaveLength(0);
    },
  );

  it('translates an email conflict from the repository', async () => {
    const repository = new InMemoryAccountRepository();
    repository.outcome = SaveAccountOutcome.EMAIL_ALREADY_REGISTERED;
    const registerAccount = new RegisterAccount(
      repository,
      new FakePasswordHasher(),
    );

    await expect(
      registerAccount.execute({
        email: 'erick@example.com',
        password: 'a secure password',
      }),
    ).rejects.toThrow(EmailAlreadyRegisteredError);
  });

  it('propagates password hasher errors unchanged', async () => {
    const hashingError = new Error('Hashing unavailable');
    const passwordHasher: PasswordHasher = {
      hash: jest
        .fn<Promise<PasswordHash>, [string]>()
        .mockRejectedValue(hashingError),
      verify: jest.fn<Promise<boolean>, [string, PasswordHash]>(),
    };
    const registerAccount = new RegisterAccount(
      new InMemoryAccountRepository(),
      passwordHasher,
    );

    await expect(
      registerAccount.execute({
        email: 'erick@example.com',
        password: 'a secure password',
      }),
    ).rejects.toBe(hashingError);
  });

  it('propagates repository errors unchanged', async () => {
    const persistenceError = new Error('Database unavailable');
    const repository: AccountRepository = {
      save: jest
        .fn<Promise<SaveAccountOutcome>, [Account]>()
        .mockRejectedValue(persistenceError),
      findByEmail: jest.fn<Promise<Account | null>, [Email]>(),
    };
    const registerAccount = new RegisterAccount(
      repository,
      new FakePasswordHasher(),
    );

    await expect(
      registerAccount.execute({
        email: 'erick@example.com',
        password: 'a secure password',
      }),
    ).rejects.toBe(persistenceError);
  });
});
