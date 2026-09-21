import { Injectable } from '@nestjs/common';
import { DrizzleQueryError } from 'drizzle-orm';
import postgres from 'postgres';
import {
  SaveAccountOutcome,
  type AccountRepository,
} from '../../../application/persistence/account.repository';
import type { Account } from '../../../domain/account/account';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import { accounts } from './identity.schema';

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
}
