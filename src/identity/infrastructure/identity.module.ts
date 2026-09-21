import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import {
  ACCOUNT_REPOSITORY,
  type AccountRepository,
} from '../application/persistence/account.repository';
import { RegisterAccount } from '../application/register-account/register-account';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from '../application/security/password-hasher';
import { AccountsController } from './http/controllers/accounts.controller';
import { DrizzleAccountRepository } from './persistence/drizzle/drizzle-account.repository';
import { Argon2idPasswordHasher } from './security/argon2id-password-hasher';

@Module({
  imports: [DatabaseModule],
  controllers: [AccountsController],
  providers: [
    DrizzleAccountRepository,
    Argon2idPasswordHasher,
    {
      provide: ACCOUNT_REPOSITORY,
      useExisting: DrizzleAccountRepository,
    },
    {
      provide: PASSWORD_HASHER,
      useExisting: Argon2idPasswordHasher,
    },
    {
      provide: RegisterAccount,
      inject: [ACCOUNT_REPOSITORY, PASSWORD_HASHER],
      useFactory: (
        accountRepository: AccountRepository,
        passwordHasher: PasswordHasher,
      ): RegisterAccount =>
        new RegisterAccount(accountRepository, passwordHasher),
    },
  ],
})
export class IdentityModule {}
