import { Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../../../../infrastructure/database/database.service';
import type {
    AccountEmail,
    AccountLookup,
} from '../../../../pet-management/application/identity/account-lookup';
import { accounts } from './identity.schema';
import { Email } from '../../../domain/email/email';

@Injectable()
export class DrizzleAccountLookup implements AccountLookup {
    constructor(private readonly databaseService: DatabaseService) {}

    async findEmailsByAccountIds(accountIds: readonly string[]): Promise<AccountEmail[]> {
        if (accountIds.length === 0) {
            return [];
        }

        const rows = await this.databaseService.connection
            .select({ accountId: accounts.id, email: accounts.email })
            .from(accounts)
            .where(inArray(accounts.id, [...accountIds]));

        return rows.map((row): AccountEmail => ({
            accountId: row.accountId,
            email: Email.from(row.email).value,
        }));
    }

    async findAccountIdByEmail(email: string): Promise<string | null> {
        const rows = await this.databaseService.connection
            .select({ id: accounts.id })
            .from(accounts)
            .where(eq(accounts.email, email))
            .limit(1);

        return rows[0]?.id ?? null;
    }

    async findEmailByAccountId(accountId: string): Promise<string | null> {
        const rows = await this.databaseService.connection
            .select({ email: accounts.email })
            .from(accounts)
            .where(eq(accounts.id, accountId))
            .limit(1);

        return rows[0] === undefined ? null : Email.from(rows[0].email).value;
    }
}
