import type { Request } from 'express';

export interface AuthenticatedAccountContext {
  readonly accountId: string;
}

export const AUTHENTICATED_ACCOUNT_CONTEXT: unique symbol = Symbol(
  'AUTHENTICATED_ACCOUNT_CONTEXT',
);

export interface AuthenticatedRequest extends Request {
  [AUTHENTICATED_ACCOUNT_CONTEXT]?: AuthenticatedAccountContext;
}
