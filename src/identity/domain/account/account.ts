import { generateUuid, isValidUuid } from '../../../shared/domain/uuid';
import { Email } from '../email/email';
import { PasswordHash } from '../password-hash/password-hash';

export class AccountId {
    private constructor(readonly value: string) {}

    static generate(): AccountId {
        return new AccountId(generateUuid());
    }

    static from(value: string): AccountId {
        if (!isValidUuid(value)) {
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
