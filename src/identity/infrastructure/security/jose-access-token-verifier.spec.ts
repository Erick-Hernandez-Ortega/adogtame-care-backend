import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { InvalidAccessTokenError } from '../../application/security/access-token-verifier';
import { AccountId } from '../../domain/account/account';
import { JoseAccessTokenIssuer } from './jose-access-token-issuer';
import { JoseAccessTokenVerifier } from './jose-access-token-verifier';

const ACCOUNT_ID: string = '018f3f4a-38d2-7b22-8b5d-6063e393d7c8';

describe('JoseAccessTokenVerifier', () => {
  let secret: string;
  let encodedSecret: Uint8Array;
  let verifier: JoseAccessTokenVerifier;

  beforeEach(() => {
    secret = randomBytes(32).toString('hex');
    encodedSecret = new TextEncoder().encode(secret);
    verifier = new JoseAccessTokenVerifier(secret);
  });

  it('accepts a token from the access token issuer and returns its subject', async () => {
    const issuer = new JoseAccessTokenIssuer(secret, 3600);
    const token: string = await issuer.issue(AccountId.from(ACCOUNT_ID));

    await expect(verifier.verify(token)).resolves.toEqual({
      subject: ACCOUNT_ID,
    });
  });

  it('rejects a token signed with a different secret', async () => {
    const issuer = new JoseAccessTokenIssuer(
      randomBytes(32).toString('hex'),
      3600,
    );
    const token: string = await issuer.issue(AccountId.from(ACCOUNT_ID));

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });

  it('rejects an expired token', async () => {
    const token: string = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(ACCOUNT_ID)
      .setExpirationTime('-1s')
      .sign(encodedSecret);

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });

  it('rejects a token without a subject', async () => {
    const token: string = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(encodedSecret);

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });

  it('rejects a token without an expiration', async () => {
    const token: string = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(ACCOUNT_ID)
      .sign(encodedSecret);

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });

  it('rejects a token using a different algorithm', async () => {
    const token: string = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS384' })
      .setSubject(ACCOUNT_ID)
      .setExpirationTime('1h')
      .sign(encodedSecret);

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });

  it('rejects a malformed token', async () => {
    await expect(verifier.verify('not-a-jwt')).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });
});
