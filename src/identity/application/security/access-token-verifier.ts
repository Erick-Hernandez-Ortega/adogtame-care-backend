export const ACCESS_TOKEN_VERIFIER: unique symbol = Symbol(
  'ACCESS_TOKEN_VERIFIER',
);

export interface VerifiedAccessToken {
  readonly subject: string;
}

export interface AccessTokenVerifier {
  verify(token: string): Promise<VerifiedAccessToken>;
}

export class InvalidAccessTokenError extends Error {
  constructor(cause?: unknown) {
    super('Access token is invalid', { cause });
    this.name = 'InvalidAccessTokenError';
  }
}
