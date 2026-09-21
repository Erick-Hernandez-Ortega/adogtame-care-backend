import { errors, jwtVerify } from 'jose';
import {
  InvalidAccessTokenError,
  type AccessTokenVerifier,
  type VerifiedAccessToken,
} from '../../application/security/access-token-verifier';

export class JoseAccessTokenVerifier implements AccessTokenVerifier {
  private readonly encodedSecret: Uint8Array;

  constructor(secret: string) {
    this.encodedSecret = new TextEncoder().encode(secret);
  }

  async verify(token: string): Promise<VerifiedAccessToken> {
    try {
      const { payload } = await jwtVerify(token, this.encodedSecret, {
        algorithms: ['HS256'],
        requiredClaims: ['sub', 'exp'],
      });

      if (typeof payload.sub !== 'string') {
        throw new InvalidAccessTokenError();
      }

      return { subject: payload.sub };
    } catch (error: unknown) {
      if (error instanceof InvalidAccessTokenError) {
        throw error;
      }

      if (error instanceof errors.JOSEError) {
        throw new InvalidAccessTokenError(error);
      }

      throw error;
    }
  }
}
