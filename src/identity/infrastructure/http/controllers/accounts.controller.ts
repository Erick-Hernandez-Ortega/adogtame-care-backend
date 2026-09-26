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
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { errorSchema } from '../../../../infrastructure/http/openapi-error.schema';
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
import {
  registerAccountRequestSchema,
  registeredAccountResponseSchema,
} from '../schemas/openapi.schemas';

@Controller('accounts')
@ApiTags('Accounts')
export class AccountsController {
  constructor(private readonly registerAccount: RegisterAccount) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register an account',
    description:
      'Email is normalized. Passwords must contain 12 to 128 characters.',
  })
  @ApiBody({
    schema: registerAccountRequestSchema,
    examples: {
      account: {
        value: { email: 'alex@example.com', password: 'a secure password' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Account registered',
    schema: registeredAccountResponseSchema,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request body',
    schema: errorSchema(['INVALID_REQUEST'], 'Request body is invalid'),
  })
  @ApiResponse({
    status: 409,
    description: 'Email already registered',
    schema: errorSchema(
      ['EMAIL_ALREADY_REGISTERED'],
      'Email is already registered',
    ),
  })
  @ApiResponse({
    status: 422,
    description: 'Invalid email or password',
    schema: errorSchema(
      ['INVALID_EMAIL', 'INVALID_PASSWORD'],
      'Email format is invalid',
    ),
  })
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
