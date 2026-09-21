import { SignJWT } from 'jose';
import type { AccessTokenIssuer } from '../../application/security/access-token-issuer';
import type { AccountId } from '../../domain/account/account';

export class JoseAccessTokenIssuer implements AccessTokenIssuer {
  private readonly encodedSecret: Uint8Array;

  constructor(
    secret: string,
    private readonly timeToLiveSeconds: number,
  ) {
    this.encodedSecret = new TextEncoder().encode(secret);
  }

  issue(accountId: AccountId): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(accountId.value)
      .setIssuedAt()
      .setExpirationTime(`${this.timeToLiveSeconds}s`)
      .sign(this.encodedSecret);
  }
}
