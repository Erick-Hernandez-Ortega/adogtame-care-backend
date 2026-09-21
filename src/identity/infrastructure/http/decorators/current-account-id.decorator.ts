import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import {
  AUTHENTICATED_ACCOUNT_CONTEXT,
  type AuthenticatedAccountContext,
  type AuthenticatedRequest,
} from '../authentication/authentication-context';

export function getCurrentAccountId(context: ExecutionContext): string {
  const request: AuthenticatedRequest = context
    .switchToHttp()
    .getRequest<AuthenticatedRequest>();
  const authenticatedAccount: AuthenticatedAccountContext | undefined =
    request[AUTHENTICATED_ACCOUNT_CONTEXT];

  if (authenticatedAccount === undefined) {
    throw new Error(
      'Authenticated account context is missing; AuthenticationGuard must run first',
    );
  }

  return authenticatedAccount.accountId;
}

export const CurrentAccountId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string =>
    getCurrentAccountId(context),
);
