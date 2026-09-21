import { ExecutionContext } from '@nestjs/common';
import {
  SaveAccountOutcome,
  type AccountRepository,
} from '../../../application/persistence/account.repository';
import {
  InvalidAccessTokenError,
  type AccessTokenVerifier,
  type VerifiedAccessToken,
} from '../../../application/security/access-token-verifier';
import { Account, AccountId } from '../../../domain/account/account';
import { Email } from '../../../domain/email/email';
import { PasswordHash } from '../../../domain/password-hash/password-hash';
import { getCurrentAccountId } from '../decorators/current-account-id.decorator';
import {
  AUTHENTICATED_ACCOUNT_CONTEXT,
  type AuthenticatedRequest,
} from './authentication-context';
import { AuthenticationGuard } from './authentication.guard';

const ACCOUNT_ID: string = '018f3f4a-38d2-7b22-8b5d-6063e393d7c8';

function createAccount(): Account {
  return Account.reconstitute({
    id: AccountId.from(ACCOUNT_ID),
    email: Email.from('guard@example.com'),
    passwordHash: PasswordHash.from('$argon2id$encoded-hash'),
  });
}

function createRequest(authorization?: string): AuthenticatedRequest {
  return {
    headers: { authorization },
  } as AuthenticatedRequest;
}

function createExecutionContext(
  request: AuthenticatedRequest,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

class StubAccessTokenVerifier implements AccessTokenVerifier {
  result: VerifiedAccessToken = { subject: ACCOUNT_ID };
  error: Error | undefined;
  readonly tokens: string[] = [];

  verify(token: string): Promise<VerifiedAccessToken> {
    this.tokens.push(token);

    if (this.error !== undefined) {
      return Promise.reject(this.error);
    }

    return Promise.resolve(this.result);
  }
}

class StubAccountRepository implements AccountRepository {
  account: Account | null = createAccount();
  error: Error | undefined;

  save(): Promise<SaveAccountOutcome> {
    return Promise.resolve(SaveAccountOutcome.SAVED);
  }

  findByEmail(): Promise<Account | null> {
    return Promise.resolve(this.account);
  }

  findById(): Promise<Account | null> {
    if (this.error !== undefined) {
      return Promise.reject(this.error);
    }

    return Promise.resolve(this.account);
  }
}

interface GuardFixture {
  accessTokenVerifier: StubAccessTokenVerifier;
  accountRepository: StubAccountRepository;
  guard: AuthenticationGuard;
}

function createGuardFixture(): GuardFixture {
  const accessTokenVerifier = new StubAccessTokenVerifier();
  const accountRepository = new StubAccountRepository();

  return {
    accessTokenVerifier,
    accountRepository,
    guard: new AuthenticationGuard(accessTokenVerifier, accountRepository),
  };
}

describe('AuthenticationGuard', () => {
  it('returns the exact unauthenticated response without Authorization', async () => {
    const { guard } = createGuardFixture();

    await expect(
      guard.canActivate(createExecutionContext(createRequest())),
    ).rejects.toMatchObject({
      response: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication is required',
      },
      status: 401,
    });
  });

  it.each(['Basic credentials', 'Bearer', 'Bearer token extra'])(
    'returns unauthenticated for a malformed Authorization header: %s',
    async (authorization: string) => {
      const { guard } = createGuardFixture();

      await expect(
        guard.canActivate(createExecutionContext(createRequest(authorization))),
      ).rejects.toMatchObject({
        response: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication is required',
        },
        status: 401,
      });
    },
  );

  it('allows a valid Bearer token and exposes only the account ID', async () => {
    const { guard, accessTokenVerifier } = createGuardFixture();
    const request: AuthenticatedRequest = createRequest('Bearer signed-token');
    const context: ExecutionContext = createExecutionContext(request);

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(accessTokenVerifier.tokens).toEqual(['signed-token']);
    expect(request[AUTHENTICATED_ACCOUNT_CONTEXT]).toEqual({
      accountId: ACCOUNT_ID,
    });
    expect(getCurrentAccountId(context)).toBe(ACCOUNT_ID);
  });

  it('returns unauthenticated for an invalid token', async () => {
    const { guard, accessTokenVerifier } = createGuardFixture();
    accessTokenVerifier.error = new InvalidAccessTokenError();

    await expect(
      guard.canActivate(
        createExecutionContext(createRequest('Bearer invalid-token')),
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('returns unauthenticated when the verified account no longer exists', async () => {
    const { guard, accountRepository } = createGuardFixture();
    accountRepository.account = null;

    await expect(
      guard.canActivate(
        createExecutionContext(createRequest('Bearer signed-token')),
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('returns unauthenticated when the subject is not an AccountId', async () => {
    const { guard, accessTokenVerifier } = createGuardFixture();
    accessTokenVerifier.result = { subject: 'not-an-account-id' };

    await expect(
      guard.canActivate(
        createExecutionContext(createRequest('Bearer signed-token')),
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('propagates unexpected repository errors unchanged', async () => {
    const { guard, accountRepository } = createGuardFixture();
    const repositoryError = new Error('Database unavailable');
    accountRepository.error = repositoryError;

    await expect(
      guard.canActivate(
        createExecutionContext(createRequest('Bearer signed-token')),
      ),
    ).rejects.toBe(repositoryError);
  });

  it('propagates unexpected verifier errors unchanged', async () => {
    const { guard, accessTokenVerifier } = createGuardFixture();
    const verifierError = new Error('Verifier misconfigured');
    accessTokenVerifier.error = verifierError;

    await expect(
      guard.canActivate(
        createExecutionContext(createRequest('Bearer signed-token')),
      ),
    ).rejects.toBe(verifierError);
  });

  it('fails explicitly when the decorator context is missing', () => {
    const context: ExecutionContext = createExecutionContext(createRequest());

    expect(() => getCurrentAccountId(context)).toThrow(
      'Authenticated account context is missing; AuthenticationGuard must run first',
    );
  });
});
