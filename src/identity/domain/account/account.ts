import { randomUUID } from 'node:crypto';
import { Email } from '../email/email';
import { PasswordHash } from '../password-hash/password-hash';

const CANONICAL_UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID: string = '00000000-0000-0000-0000-000000000000';

export class AccountId {
  private constructor(readonly value: string) {}

  static generate(): AccountId {
    return new AccountId(randomUUID());
  }

  static from(value: string): AccountId {
    if (
      !CANONICAL_UUID_PATTERN.test(value) ||
      value.toLowerCase() === NIL_UUID
    ) {
      throw new TypeError('Account ID must be a canonical non-nil UUID');
    }

    return new AccountId(value);
  }
}

interface RegisterAccountInput {
  email: Email;
  passwordHash: PasswordHash;
}

interface AccountProperties {
  readonly id: AccountId;
  readonly email: Email;
  readonly passwordHash: PasswordHash;
}

interface ReconstituteAccountInput {
  id: AccountId;
  email: Email;
  passwordHash: PasswordHash;
}

export class Account {
  private constructor(private readonly properties: AccountProperties) {}

  static register(input: RegisterAccountInput): Account {
    if (!(input.email instanceof Email)) {
      throw new TypeError('Account email must be an Email');
    }

    if (!(input.passwordHash instanceof PasswordHash)) {
      throw new TypeError('Account password hash must be a PasswordHash');
    }

    return new Account({
      id: AccountId.generate(),
      email: input.email,
      passwordHash: input.passwordHash,
    });
  }

  static reconstitute(input: ReconstituteAccountInput): Account {
    if (!(input.id instanceof AccountId)) {
      throw new TypeError('Account ID must be an AccountId');
    }

    if (!(input.email instanceof Email)) {
      throw new TypeError('Account email must be an Email');
    }

    if (!(input.passwordHash instanceof PasswordHash)) {
      throw new TypeError('Account password hash must be a PasswordHash');
    }

    return new Account(input);
  }

  get id(): AccountId {
    return this.properties.id;
  }

  get email(): Email {
    return this.properties.email;
  }

  get passwordHash(): PasswordHash {
    return this.properties.passwordHash;
  }
}
