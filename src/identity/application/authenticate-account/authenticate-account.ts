import type { AccountRepository } from '../persistence/account.repository';
import type { AccessTokenIssuer } from '../security/access-token-issuer';
import type { PasswordHasher } from '../security/password-hasher';
import type { Account } from '../../domain/account/account';
import { Email } from '../../domain/email/email';
import { InvalidEmailError } from '../errors/invalid-email.error';
import { InvalidCredentialsError } from './authenticate-account.errors';
import type {
  AuthenticatedAccount,
  AuthenticateAccountCommand,
} from './authenticate-account.types';

export class AuthenticateAccount {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly accessTokenIssuer: AccessTokenIssuer,
  ) {}

  async execute(
    command: AuthenticateAccountCommand,
  ): Promise<AuthenticatedAccount> {
    let email: Email;

    try {
      email = Email.from(command.email);
    } catch (error: unknown) {
      if (error instanceof TypeError) {
        throw new InvalidEmailError(error);
      }

      throw error;
    }

    const account: Account | null =
      await this.accountRepository.findByEmail(email);

    if (account === null) {
      throw new InvalidCredentialsError();
    }

    const isPasswordValid: boolean = await this.passwordHasher.verify(
      command.password,
      account.passwordHash,
    );

    if (!isPasswordValid) {
      throw new InvalidCredentialsError();
    }

    const accessToken: string = await this.accessTokenIssuer.issue(account.id);

    return { accessToken };
  }
}
