import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { DrizzleAccountLookup } from '../../src/identity/infrastructure/persistence/drizzle/drizzle-account-lookup';
import { accounts } from '../../src/identity/infrastructure/persistence/drizzle/identity.schema';
import { DatabaseService } from '../../src/infrastructure/database/database.service';

describe('DrizzleAccountLookup (integration)', () => {
  let application: INestApplicationContext;
  let databaseService: DatabaseService;
  let lookup: DrizzleAccountLookup;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    application = moduleFixture;
    databaseService = application.get(DatabaseService);
    lookup = application.get(DrizzleAccountLookup);
  });

  afterAll(async () => {
    await application.close();
  });

  it('returns only the ID for an existing normalized email and null otherwise', async () => {
    const accountId: string = randomUUID();
    const email: string = `lookup-${randomUUID()}@example.com`;

    try {
      await databaseService.connection.insert(accounts).values({
        id: accountId,
        email,
        passwordHash: '$argon2id$test-hash',
      });

      await expect(lookup.findAccountIdByEmail(email)).resolves.toBe(accountId);
      await expect(lookup.findEmailByAccountId(accountId)).resolves.toBe(email);
      await expect(
        lookup.findEmailByAccountId(randomUUID()),
      ).resolves.toBeNull();
      await expect(
        lookup.findAccountIdByEmail(`missing-${randomUUID()}@example.com`),
      ).resolves.toBeNull();
    } finally {
      await databaseService.connection
        .delete(accounts)
        .where(eq(accounts.id, accountId));
    }
  });
  it('looks up a batch with the same email normalization as individual lookups', async () => {
    const firstAccountId: string = randomUUID();
    const secondAccountId: string = randomUUID();
    const unrelatedAccountId: string = randomUUID();
    const accountIds: string[] = [
      firstAccountId,
      secondAccountId,
      unrelatedAccountId,
    ];
    const firstEmail: string = `FIRST-${firstAccountId}@Example.COM`;
    const secondEmail: string = `  Second-${secondAccountId}@Example.COM  `;
    try {
      await databaseService.connection.insert(accounts).values([
        {
          id: firstAccountId,
          email: firstEmail,
          passwordHash: 'test-password-hash',
        },
        {
          id: secondAccountId,
          email: secondEmail,
          passwordHash: 'test-password-hash',
        },
        {
          id: unrelatedAccountId,
          email: `${unrelatedAccountId}@example.com`,
          passwordHash: 'test-password-hash',
        },
      ]);
      const result = await lookup.findEmailsByAccountIds([
        secondAccountId,
        randomUUID(),
        firstAccountId,
        firstAccountId,
      ]);
      expect(result).toHaveLength(2);
      expect(result).toEqual(
        expect.arrayContaining([
          { accountId: firstAccountId, email: firstEmail.toLowerCase() },
          {
            accountId: secondAccountId,
            email: secondEmail.trim().toLowerCase(),
          },
        ]),
      );
      for (const account of result) {
        await expect(
          lookup.findEmailByAccountId(account.accountId),
        ).resolves.toBe(account.email);
        expect(Object.keys(account).sort()).toEqual(['accountId', 'email']);
      }
      await expect(lookup.findEmailsByAccountIds([])).resolves.toEqual([]);
      await expect(
        lookup.findEmailsByAccountIds([randomUUID()]),
      ).resolves.toEqual([]);
    } finally {
      await databaseService.connection
        .delete(accounts)
        .where(inArray(accounts.id, accountIds));
    }
  });

  it('propagates invalid stored email data instead of manufacturing an email', async () => {
    const accountId: string = randomUUID();
    try {
      await databaseService.connection.insert(accounts).values({
        id: accountId,
        email: 'invalid-email',
        passwordHash: 'test-password-hash',
      });
      await expect(lookup.findEmailsByAccountIds([accountId])).rejects.toThrow(
        'Email format is invalid',
      );
      await expect(lookup.findEmailByAccountId(accountId)).rejects.toThrow(
        'Email format is invalid',
      );
    } finally {
      await databaseService.connection
        .delete(accounts)
        .where(eq(accounts.id, accountId));
    }
  });
});
