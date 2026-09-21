import {
  SaveAccountOutcome,
  type AccountRepository,
} from '../persistence/account.repository';
import type { PasswordHasher } from '../security/password-hasher';
import { Account } from '../../domain/account/account';
import { Email } from '../../domain/email/email';
import { PasswordHash } from '../../domain/password-hash/password-hash';
import { InvalidEmailError } from '../errors/invalid-email.error';
import { assertPasswordMeetsPolicy } from './password-policy';
import { EmailAlreadyRegisteredError } from './register-account.errors';
import type {
  RegisteredAccount,
  RegisterAccountCommand,
} from './register-account.types';

export class RegisterAccount {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async execute(command: RegisterAccountCommand): Promise<RegisteredAccount> {
    let email: Email;

    try {
      email = Email.from(command.email);
    } catch (error: unknown) {
      if (error instanceof TypeError) {
        throw new InvalidEmailError(error);
      }

      throw error;
    }

    assertPasswordMeetsPolicy(command.password);

    const passwordHash: PasswordHash = await this.passwordHasher.hash(
      command.password,
    );
    const account: Account = Account.register({ email, passwordHash });
    const outcome: SaveAccountOutcome =
      await this.accountRepository.save(account);

    if (outcome === SaveAccountOutcome.EMAIL_ALREADY_REGISTERED) {
      throw new EmailAlreadyRegisteredError();
    }

    return {
      id: account.id.value,
      email: account.email.value,
    };
  }
}
