import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { AppModule } from '../../src/app.module';
import {
  SaveAccountOutcome,
  type SaveAccountOutcome as SaveAccountOutcomeType,
} from '../../src/identity/application/persistence/account.repository';
import { Account } from '../../src/identity/domain/account/account';
import { Email } from '../../src/identity/domain/email/email';
import { PasswordHash } from '../../src/identity/domain/password-hash/password-hash';
import { DrizzleAccountRepository } from '../../src/identity/infrastructure/persistence/drizzle/drizzle-account.repository';
import { accounts } from '../../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../../src/infrastructure/database/database.service';

function createAccount(email: string): Account {
  return Account.register({
    email: Email.from(email),
    passwordHash: PasswordHash.from('$argon2id$encoded-hash'),
  });
}

describe('DrizzleAccountRepository (integration)', () => {
  let application: INestApplicationContext;
  let databaseService: DatabaseService;
  let repository: DrizzleAccountRepository;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    application = moduleFixture;
    databaseService = application.get(DatabaseService);
    repository = new DrizzleAccountRepository(databaseService);
  });

  afterAll(async () => {
    await application.close();
  });

  it('maps and saves an account', async () => {
    const email: string = 'repository-mapping@example.com';
    const account: Account = createAccount(email);

    try {
      await expect(repository.save(account)).resolves.toBe(
        SaveAccountOutcome.SAVED,
      );

      const savedAccounts = await databaseService.connection
        .select()
        .from(accounts)
        .where(eq(accounts.id, account.id.value));

      expect(savedAccounts).toEqual([
        {
          id: account.id.value,
          email,
          passwordHash: '$argon2id$encoded-hash',
        },
      ]);
    } finally {
      await databaseService.connection
        .delete(accounts)
        .where(eq(accounts.id, account.id.value));
    }
  });

  it('lets PostgreSQL resolve concurrent registrations of the same email', async () => {
    const email: string = 'repository-concurrent@example.com';
    const firstAccount: Account = createAccount(email);
    const secondAccount: Account = createAccount(` ${email.toUpperCase()} `);

    try {
      const outcomes: SaveAccountOutcomeType[] = await Promise.all([
        repository.save(firstAccount),
        repository.save(secondAccount),
      ]);

      expect(outcomes).toEqual(
        expect.arrayContaining([
          SaveAccountOutcome.SAVED,
          SaveAccountOutcome.EMAIL_ALREADY_REGISTERED,
        ]),
      );
      const savedAccounts = await databaseService.connection
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.email, email));
      expect(savedAccounts).toHaveLength(1);
    } finally {
      await databaseService.connection
        .delete(accounts)
        .where(eq(accounts.email, email));
    }
  });
});
