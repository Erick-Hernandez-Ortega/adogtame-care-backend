import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { AuthenticationGuard } from '../../../../identity/infrastructure/http/authentication/authentication.guard';
import { CurrentAccountId } from '../../../../identity/infrastructure/http/decorators/current-account-id.decorator';
import { PetNotFoundError } from '../../../application/errors/pet-not-found.error';
import { GetPetDetail } from '../../../application/get-pet-detail/get-pet-detail';
import {
  AlreadyPetMemberError,
  InvalidInvitedEmailError,
  InvitationAlreadyPendingError,
  InviteCollaborator,
} from '../../../application/invite-collaborator/invite-collaborator';
import type { CreatedPetInvitation } from '../../../application/invite-collaborator/invite-collaborator.types';
import { ListMyPets } from '../../../application/list-my-pets/list-my-pets';
import type {
  AccessiblePetSummary,
  PetDetail,
} from '../../../application/persistence/pet-query.repository';
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
import { petIdSchema } from '../schemas/get-pet-detail.schema';
import {
  inviteCollaboratorSchema,
  type InviteCollaboratorRequest,
} from '../schemas/invite-collaborator.schema';

@Controller('pets')
export class PetsController {
  constructor(
    private readonly registerPet: RegisterPet,
    private readonly listMyPets: ListMyPets,
    private readonly getPetDetail: GetPetDetail,
    private readonly inviteCollaborator: InviteCollaborator,
  ) {}

  @Get()
  @UseGuards(AuthenticationGuard)
  list(@CurrentAccountId() accountId: string): Promise<AccessiblePetSummary[]> {
    return this.listMyPets.execute(accountId);
  }

  @Get(':petId')
  @UseGuards(AuthenticationGuard)
  async detail(
    @CurrentAccountId() accountId: string,
    @Param('petId') petId: string,
  ): Promise<PetDetail> {
    const result = petIdSchema.safeParse(petId);

    if (!result.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Pet id is invalid',
      });
    }

    try {
      return await this.getPetDetail.execute(result.data, accountId);
    } catch (error: unknown) {
      if (error instanceof PetNotFoundError) {
        throw new NotFoundException({
          code: 'PET_NOT_FOUND',
          message: error.message,
        });
      }

      throw error;
    }
  }

  @Post(':petId/invitations')
  @UseGuards(AuthenticationGuard)
  @HttpCode(HttpStatus.CREATED)
  async invite(
    @CurrentAccountId() invitedByAccountId: string,
    @Param('petId') petId: string,
    @Body() body: unknown,
  ): Promise<CreatedPetInvitation> {
    const petIdResult = petIdSchema.safeParse(petId);

    if (!petIdResult.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Pet id is invalid',
      });
    }

    const bodyResult = inviteCollaboratorSchema.safeParse(body);

    if (!bodyResult.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request body is invalid',
      });
    }

    const request: InviteCollaboratorRequest = bodyResult.data;

    try {
      return await this.inviteCollaborator.execute({
        petId: petIdResult.data,
        invitedByAccountId,
        email: request.email,
      });
    } catch (error: unknown) {
      if (error instanceof PetNotFoundError) {
        throw new NotFoundException({
          code: 'PET_NOT_FOUND',
          message: error.message,
        });
      }

      if (error instanceof InvalidInvitedEmailError) {
        throw new UnprocessableEntityException({
          code: 'INVALID_EMAIL',
          message: error.message,
        });
      }

      if (error instanceof AlreadyPetMemberError) {
        throw new ConflictException({
          code: 'ALREADY_PET_MEMBER',
          message: error.message,
        });
      }

      if (error instanceof InvitationAlreadyPendingError) {
        throw new ConflictException({
          code: 'INVITATION_ALREADY_PENDING',
          message: error.message,
        });
      }

      throw error;
    }
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
