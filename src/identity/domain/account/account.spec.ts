import { Account, AccountId } from './account';
import { Email } from '../email/email';
import { PasswordHash } from '../password-hash/password-hash';

const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('Account', () => {
  it('registers an account with a generated identity', () => {
    const email: Email = Email.from('erick@example.com');
    const passwordHash: PasswordHash = PasswordHash.from(
      '$argon2id$encoded-hash',
    );

    const account: Account = Account.register({ email, passwordHash });

    expect(account.id).toBeInstanceOf(AccountId);
    expect(account.id.value).toMatch(UUID_PATTERN);
    expect(account.email).toBe(email);
    expect(account.passwordHash).toBe(passwordHash);
  });

  it('generates a different identity for each account', () => {
    const input = {
      email: Email.from('erick@example.com'),
      passwordHash: PasswordHash.from('$argon2id$encoded-hash'),
    };

    const firstAccount: Account = Account.register(input);
    const secondAccount: Account = Account.register(input);

    expect(firstAccount.id.value).not.toBe(secondAccount.id.value);
  });

  it('rejects a raw email instead of an Email value object', () => {
    const rawEmail: Email = 'erick@example.com' as unknown as Email;

    expect(() =>
      Account.register({
        email: rawEmail,
        passwordHash: PasswordHash.from('$argon2id$encoded-hash'),
      }),
    ).toThrow('Account email must be an Email');
  });

  it('rejects a plaintext password instead of a PasswordHash value object', () => {
    const plaintextPassword: PasswordHash =
      'a secure password' as unknown as PasswordHash;

    expect(() =>
      Account.register({
        email: Email.from('erick@example.com'),
        passwordHash: plaintextPassword,
      }),
    ).toThrow('Account password hash must be a PasswordHash');
  });
});
