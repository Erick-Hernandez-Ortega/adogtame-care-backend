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
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { errorSchema } from '../../../../infrastructure/http/openapi-error.schema';
import { AuthenticateAccount } from '../../../application/authenticate-account/authenticate-account';
import { InvalidCredentialsError } from '../../../application/authenticate-account/authenticate-account.errors';
import type {
  AuthenticatedAccount,
  AuthenticateAccountCommand,
} from '../../../application/authenticate-account/authenticate-account.types';
import { InvalidEmailError } from '../../../application/errors/invalid-email.error';
import { authenticateAccountSchema } from '../schemas/authenticate-account.schema';
import {
  authenticateAccountRequestSchema,
  authenticatedAccountResponseSchema,
} from '../schemas/openapi.schemas';

@Controller('auth')
@ApiTags('Authentication')
export class AuthController {
  constructor(private readonly authenticateAccount: AuthenticateAccount) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in to an account' })
  @ApiBody({
    schema: authenticateAccountRequestSchema,
    examples: {
      credentials: {
        value: { email: 'alex@example.com', password: 'a secure password' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'JWT access token',
    schema: authenticatedAccountResponseSchema,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request body',
    schema: errorSchema(['INVALID_REQUEST'], 'Request body is invalid'),
  })
  @ApiResponse({
    status: 401,
    description: 'Incorrect credentials',
    schema: errorSchema(
      ['INVALID_CREDENTIALS'],
      'Email or password is incorrect',
    ),
  })
  @ApiResponse({
    status: 422,
    description: 'Invalid email',
    schema: errorSchema(['INVALID_EMAIL'], 'Email format is invalid'),
  })
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
