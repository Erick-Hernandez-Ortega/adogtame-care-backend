import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import type { EnvironmentVariables } from '../../infrastructure/config/environment.validation';
import { AuthenticateAccount } from '../application/authenticate-account/authenticate-account';
import {
  ACCOUNT_REPOSITORY,
  type AccountRepository,
} from '../application/persistence/account.repository';
import { RegisterAccount } from '../application/register-account/register-account';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from '../application/security/password-hasher';
import {
  ACCESS_TOKEN_ISSUER,
  type AccessTokenIssuer,
} from '../application/security/access-token-issuer';
import { AccountsController } from './http/controllers/accounts.controller';
import { AuthController } from './http/controllers/auth.controller';
import { DrizzleAccountRepository } from './persistence/drizzle/drizzle-account.repository';
import { Argon2idPasswordHasher } from './security/argon2id-password-hasher';
import { JoseAccessTokenIssuer } from './security/jose-access-token-issuer';

@Module({
  imports: [DatabaseModule],
  controllers: [AccountsController, AuthController],
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
      provide: ACCESS_TOKEN_ISSUER,
      inject: [ConfigService],
      useFactory: (
        configService: ConfigService<EnvironmentVariables, true>,
      ): AccessTokenIssuer =>
        new JoseAccessTokenIssuer(
          configService.getOrThrow('JWT_ACCESS_TOKEN_SECRET', { infer: true }),
          configService.getOrThrow('JWT_ACCESS_TOKEN_TTL_SECONDS', {
            infer: true,
          }),
        ),
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
    {
      provide: AuthenticateAccount,
      inject: [ACCOUNT_REPOSITORY, PASSWORD_HASHER, ACCESS_TOKEN_ISSUER],
      useFactory: (
        accountRepository: AccountRepository,
        passwordHasher: PasswordHasher,
        accessTokenIssuer: AccessTokenIssuer,
      ): AuthenticateAccount =>
        new AuthenticateAccount(
          accountRepository,
          passwordHasher,
          accessTokenIssuer,
        ),
    },
  ],
})
export class IdentityModule {}
