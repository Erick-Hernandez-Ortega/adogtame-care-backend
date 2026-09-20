import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  InvalidPetRegistrationError,
  RegisterPet,
} from '../../../application/register-pet/register-pet';
import type {
  RegisteredPet,
  RegisterPetCommand,
} from '../../../application/register-pet/register-pet.types';
import { registerPetSchema } from '../schemas/register-pet.schema';

@Controller('pets')
export class PetsController {
  constructor(private readonly registerPet: RegisterPet) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown): Promise<RegisteredPet> {
    const result = registerPetSchema.safeParse(body);

    if (!result.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request body is invalid',
      });
    }

    const command: RegisterPetCommand = result.data;

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
