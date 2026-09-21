import { Injectable } from '@nestjs/common';
import { DrizzleQueryError, eq } from 'drizzle-orm';
import postgres from 'postgres';
import {
  SaveAccountOutcome,
  type AccountRepository,
} from '../../../application/persistence/account.repository';
import { Account, AccountId } from '../../../domain/account/account';
import type { Email } from '../../../domain/email/email';
import { Email as AccountEmail } from '../../../domain/email/email';
import { PasswordHash } from '../../../domain/password-hash/password-hash';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import { accounts } from './identity.schema';

interface AccountRow {
  id: string;
  email: string;
  passwordHash: string;
}

@Injectable()
export class DrizzleAccountRepository implements AccountRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async save(account: Account): Promise<SaveAccountOutcome> {
    try {
      await this.databaseService.connection.insert(accounts).values({
        id: account.id.value,
        email: account.email.value,
        passwordHash: account.passwordHash.value,
      });

      return SaveAccountOutcome.SAVED;
    } catch (error: unknown) {
      const cause: unknown =
        error instanceof DrizzleQueryError ? error.cause : error;

      if (
        cause instanceof postgres.PostgresError &&
        cause.code === '23505' &&
        cause.constraint_name === 'accounts_email_unique'
      ) {
        return SaveAccountOutcome.EMAIL_ALREADY_REGISTERED;
      }

      throw error;
    }
  }

  async findByEmail(email: Email): Promise<Account | null> {
    const rows = await this.databaseService.connection
      .select()
      .from(accounts)
      .where(eq(accounts.email, email.value))
      .limit(1);
    const row = rows[0];

    if (row === undefined) {
      return null;
    }

    return this.toDomain(row);
  }

  async findById(accountId: AccountId): Promise<Account | null> {
    const rows = await this.databaseService.connection
      .select()
      .from(accounts)
      .where(eq(accounts.id, accountId.value))
      .limit(1);
    const row = rows[0];

    if (row === undefined) {
      return null;
    }

    return this.toDomain(row);
  }

  private toDomain(row: AccountRow): Account {
    return Account.reconstitute({
      id: AccountId.from(row.id),
      email: AccountEmail.from(row.email),
      passwordHash: PasswordHash.from(row.passwordHash),
    });
  }
}
