import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuthenticateAccount } from '../../../application/authenticate-account/authenticate-account';
import { InvalidCredentialsError } from '../../../application/authenticate-account/authenticate-account.errors';
import type {
  AuthenticatedAccount,
  AuthenticateAccountCommand,
} from '../../../application/authenticate-account/authenticate-account.types';
import { InvalidEmailError } from '../../../application/errors/invalid-email.error';
import { authenticateAccountSchema } from '../schemas/authenticate-account.schema';

@Controller('auth')
export class AuthController {
  constructor(private readonly authenticateAccount: AuthenticateAccount) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: unknown): Promise<AuthenticatedAccount> {
    const result = authenticateAccountSchema.safeParse(body);

    if (!result.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request body is invalid',
      });
    }

    const command: AuthenticateAccountCommand = result.data;

    try {
      return await this.authenticateAccount.execute(command);
    } catch (error: unknown) {
      if (error instanceof InvalidEmailError) {
        throw new UnprocessableEntityException({
          code: 'INVALID_EMAIL',
          message: error.message,
        });
      }

      if (error instanceof InvalidCredentialsError) {
        throw new UnauthorizedException({
          code: 'INVALID_CREDENTIALS',
          message: error.message,
        });
      }

      throw error;
    }
  }
}
