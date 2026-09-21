import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { RegisterAccount } from '../../../application/register-account/register-account';
import {
  EmailAlreadyRegisteredError,
  InvalidPasswordError,
} from '../../../application/register-account/register-account.errors';
import { InvalidEmailError } from '../../../application/errors/invalid-email.error';
import type {
  RegisteredAccount,
  RegisterAccountCommand,
} from '../../../application/register-account/register-account.types';
import { registerAccountSchema } from '../schemas/register-account.schema';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly registerAccount: RegisterAccount) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown): Promise<RegisteredAccount> {
    const result = registerAccountSchema.safeParse(body);

    if (!result.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request body is invalid',
      });
    }

    const command: RegisterAccountCommand = result.data;

    try {
      return await this.registerAccount.execute(command);
    } catch (error: unknown) {
      if (error instanceof InvalidEmailError) {
        throw new UnprocessableEntityException({
          code: 'INVALID_EMAIL',
          message: error.message,
        });
      }

      if (error instanceof InvalidPasswordError) {
        throw new UnprocessableEntityException({
          code: 'INVALID_PASSWORD',
          message: error.message,
        });
      }

      if (error instanceof EmailAlreadyRegisteredError) {
        throw new ConflictException({
          code: 'EMAIL_ALREADY_REGISTERED',
          message: error.message,
        });
      }

      throw error;
    }
  }
}
