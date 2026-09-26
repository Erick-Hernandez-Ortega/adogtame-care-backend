import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { AuthenticationGuard } from '../../../../identity/infrastructure/http/authentication/authentication.guard';
import { CurrentAccountId } from '../../../../identity/infrastructure/http/decorators/current-account-id.decorator';
import { ListMyPets } from '../../../application/list-my-pets/list-my-pets';
import type { AccessiblePetSummary } from '../../../application/persistence/pet-query.repository';
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
  constructor(
    private readonly registerPet: RegisterPet,
    private readonly listMyPets: ListMyPets,
  ) {}

  @Get()
  @UseGuards(AuthenticationGuard)
  list(@CurrentAccountId() accountId: string): Promise<AccessiblePetSummary[]> {
    return this.listMyPets.execute(accountId);
  }

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
