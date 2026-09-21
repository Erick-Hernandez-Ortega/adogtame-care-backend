import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { AuthenticationGuard } from '../../../../identity/infrastructure/http/authentication/authentication.guard';
import { CurrentAccountId } from '../../../../identity/infrastructure/http/decorators/current-account-id.decorator';
import {
  InvalidPetRegistrationError,
  RegisterPet,
} from '../../../application/register-pet/register-pet';
import type {
  RegisteredPet,
  RegisterPetCommand,
} from '../../../application/register-pet/register-pet.types';
import {
  registerPetSchema,
  type RegisterPetRequest,
} from '../schemas/register-pet.schema';

@Controller('pets')
export class PetsController {
  constructor(private readonly registerPet: RegisterPet) {}

  @Post()
  @UseGuards(AuthenticationGuard)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentAccountId() ownerAccountId: string,
    @Body() body: unknown,
  ): Promise<RegisteredPet> {
    const result = registerPetSchema.safeParse(body);

    if (!result.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request body is invalid',
      });
    }

    const request: RegisterPetRequest = result.data;
    const command: RegisterPetCommand = {
      ...request,
      ownerAccountId,
    };

    try {
      return await this.registerPet.execute(command);
    } catch (error: unknown) {
      if (error instanceof InvalidPetRegistrationError) {
        throw new UnprocessableEntityException({
          code: 'INVALID_PET',
          message: error.message,
        });
      }

      throw error;
    }
  }
}
