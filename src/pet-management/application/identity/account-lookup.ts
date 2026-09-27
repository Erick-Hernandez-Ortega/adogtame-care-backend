export const ACCOUNT_LOOKUP: unique symbol = Symbol('ACCOUNT_LOOKUP');

export interface AccountLookup {
  findAccountIdByEmail(email: string): Promise<string | null>;
  findEmailByAccountId(accountId: string): Promise<string | null>;
}
