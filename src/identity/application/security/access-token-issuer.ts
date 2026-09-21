import type { AccountId } from '../../domain/account/account';

export const ACCESS_TOKEN_ISSUER: unique symbol = Symbol('ACCESS_TOKEN_ISSUER');

export interface AccessTokenIssuer {
  issue(accountId: AccountId): Promise<string>;
}
