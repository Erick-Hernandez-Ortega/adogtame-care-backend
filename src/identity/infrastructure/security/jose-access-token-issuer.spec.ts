import { randomBytes } from 'node:crypto';
import { jwtVerify } from 'jose';
import { AccountId } from '../../domain/account/account';
import { JoseAccessTokenIssuer } from './jose-access-token-issuer';

describe('JoseAccessTokenIssuer', () => {
  it('issues a verifiable HS256 token with subject and a one-hour lifetime', async () => {
    const secret: string = randomBytes(32).toString('hex');
    const issuer = new JoseAccessTokenIssuer(secret, 3600);
    const accountId: AccountId = AccountId.from(
      '018f3f4a-38d2-7b22-8b5d-6063e393d7c8',
    );

    const accessToken: string = await issuer.issue(accountId);
    const { payload, protectedHeader } = await jwtVerify(
      accessToken,
      new TextEncoder().encode(secret),
      { algorithms: ['HS256'] },
    );
    const payloadKeys: string[] = Object.keys(payload).sort();

    expect(protectedHeader.alg).toBe('HS256');
    expect(payloadKeys).toEqual(['exp', 'iat', 'sub']);
    expect(payload.sub).toBe(accountId.value);
    expect(payload.iat).toEqual(expect.any(Number));
    expect(payload.exp).toBe((payload.iat as number) + 3600);
  });
});
