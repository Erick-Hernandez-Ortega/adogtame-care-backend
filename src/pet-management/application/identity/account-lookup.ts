export const ACCOUNT_LOOKUP: unique symbol = Symbol('ACCOUNT_LOOKUP');

export interface AccountEmail {
  readonly accountId: string;
  readonly email: string;
}

export interface AccountLookup {
  findEmailsByAccountIds(
    accountIds: readonly string[],
  ): Promise<AccountEmail[]>;
  findAccountIdByEmail(email: string): Promise<string | null>;
  findEmailByAccountId(accountId: string): Promise<string | null>;
}
