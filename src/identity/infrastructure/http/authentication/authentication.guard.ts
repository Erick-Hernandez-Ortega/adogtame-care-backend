import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ACCOUNT_REPOSITORY,
  type AccountRepository,
} from '../../../application/persistence/account.repository';
import {
  ACCESS_TOKEN_VERIFIER,
  InvalidAccessTokenError,
  type AccessTokenVerifier,
  type VerifiedAccessToken,
} from '../../../application/security/access-token-verifier';
import { Account, AccountId } from '../../../domain/account/account';
import {
  AUTHENTICATED_ACCOUNT_CONTEXT,
  type AuthenticatedRequest,
} from './authentication-context';

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    @Inject(ACCESS_TOKEN_VERIFIER)
    private readonly accessTokenVerifier: AccessTokenVerifier,
    @Inject(ACCOUNT_REPOSITORY)
    private readonly accountRepository: AccountRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: AuthenticatedRequest = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();
    const token: string = this.extractBearerToken(
      request.headers.authorization,
    );
    let verifiedAccessToken: VerifiedAccessToken;

    try {
      verifiedAccessToken = await this.accessTokenVerifier.verify(token);
    } catch (error: unknown) {
      if (error instanceof InvalidAccessTokenError) {
        throw this.unauthenticated();
      }

      throw error;
    }

    let accountId: AccountId;

    try {
      accountId = AccountId.from(verifiedAccessToken.subject);
    } catch (error: unknown) {
      if (error instanceof TypeError) {
        throw this.unauthenticated();
      }

      throw error;
    }

    const account: Account | null =
      await this.accountRepository.findById(accountId);

    if (account === null) {
      throw this.unauthenticated();
    }

    request[AUTHENTICATED_ACCOUNT_CONTEXT] = {
      accountId: account.id.value,
    };

    return true;
  }

  private extractBearerToken(authorization: string | undefined): string {
    if (authorization === undefined) {
      throw this.unauthenticated();
    }

    const parts: string[] = authorization.trim().split(/\s+/);

    if (
      parts.length !== 2 ||
      parts[0].toLowerCase() !== 'bearer' ||
      parts[1].length === 0
    ) {
      throw this.unauthenticated();
    }

    return parts[1];
  }

  private unauthenticated(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'UNAUTHENTICATED',
      message: 'Authentication is required',
    });
  }
}
