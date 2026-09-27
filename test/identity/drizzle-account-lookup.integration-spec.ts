import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
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
});
