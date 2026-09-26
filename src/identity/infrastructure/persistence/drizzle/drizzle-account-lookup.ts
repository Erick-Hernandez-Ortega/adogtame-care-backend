import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import type { AccountLookup } from '../../../../pet-management/application/identity/account-lookup';
import { accounts } from './identity.schema';

@Injectable()
export class DrizzleAccountLookup implements AccountLookup {
  constructor(private readonly databaseService: DatabaseService) {}

  async findAccountIdByEmail(email: string): Promise<string | null> {
    const rows = await this.databaseService.connection
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.email, email))
      .limit(1);

    return rows[0]?.id ?? null;
  }
}
