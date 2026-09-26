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
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { errorSchema } from '../../../../infrastructure/http/openapi-error.schema';
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
import {
  createdInvitationResponseSchema,
  inviteCollaboratorRequestSchema,
  petDetailResponseSchema,
  petSummaryResponseSchema,
  registeredPetResponseSchema,
  registerPetRequestSchema,
} from '../schemas/openapi.schemas';

@Controller('pets')
@ApiTags('Pets')
@ApiBearerAuth()
export class PetsController {
  constructor(
    private readonly registerPet: RegisterPet,
    private readonly listMyPets: ListMyPets,
    private readonly getPetDetail: GetPetDetail,
    private readonly inviteCollaborator: InviteCollaborator,
  ) {}

  @Get()
  @UseGuards(AuthenticationGuard)
  @ApiOperation({ summary: 'List pets accessible to the current account' })
  @ApiResponse({
    status: 200,
    description: 'Accessible pets',
    schema: { type: 'array', items: petSummaryResponseSchema },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid Bearer token',
    schema: errorSchema(['UNAUTHENTICATED'], 'Authentication is required'),
  })
  list(@CurrentAccountId() accountId: string): Promise<AccessiblePetSummary[]> {
    return this.listMyPets.execute(accountId);
  }

  @Get(':petId')
  @UseGuards(AuthenticationGuard)
  @ApiOperation({ summary: 'Get an accessible pet profile' })
  @ApiParam({
    name: 'petId',
    description: 'Pet UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiResponse({
    status: 200,
    description: 'Pet profile and current account role',
    schema: petDetailResponseSchema,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid pet UUID',
    schema: errorSchema(['INVALID_REQUEST'], 'Pet id is invalid'),
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid Bearer token',
    schema: errorSchema(['UNAUTHENTICATED'], 'Authentication is required'),
  })
  @ApiResponse({
    status: 404,
    description: 'Pet is missing or inaccessible',
    schema: errorSchema(['PET_NOT_FOUND'], 'Pet was not found'),
  })
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
  @ApiOperation({
    summary: 'Invite a collaborator to a pet',
    description:
      'Only an active owner can invite a collaborator. The invitation is pending until accepted or expired.',
  })
  @ApiParam({
    name: 'petId',
    description: 'Pet UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBody({
    schema: inviteCollaboratorRequestSchema,
    examples: { invitation: { value: { email: 'friend@example.com' } } },
  })
  @ApiResponse({
    status: 201,
    description: 'Pending invitation created',
    schema: createdInvitationResponseSchema,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid pet UUID or request body',
    schema: errorSchema(['INVALID_REQUEST'], 'Request body is invalid'),
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid Bearer token',
    schema: errorSchema(['UNAUTHENTICATED'], 'Authentication is required'),
  })
  @ApiResponse({
    status: 404,
    description: 'Pet is missing or current account is not an owner',
    schema: errorSchema(['PET_NOT_FOUND'], 'Pet was not found'),
  })
  @ApiResponse({
    status: 409,
    description: 'Existing member or pending invitation',
    schema: errorSchema(
      ['ALREADY_PET_MEMBER', 'INVITATION_ALREADY_PENDING'],
      'Account is already a member of this pet',
    ),
  })
  @ApiResponse({
    status: 422,
    description: 'Invalid invited email',
    schema: errorSchema(['INVALID_EMAIL'], 'Email format is invalid'),
  })
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
  @ApiOperation({
    summary: 'Register a pet',
    description:
      'The current account becomes the first owner. Birth dates use YYYY-MM-DD; accuracy says whether the date is exact or approximate.',
  })
  @ApiBody({
    schema: registerPetRequestSchema,
    examples: {
      dog: {
        value: {
          name: 'Luna',
          species: 'DOG',
          breed: { name: 'Mixed breed', kind: 'CUSTOM' },
          sex: 'FEMALE',
          birthInformation: { date: '2022-05-15', accuracy: 'APPROXIMATE' },
          color: 'Brown',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Pet registered with owner membership',
    schema: registeredPetResponseSchema,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request body',
    schema: errorSchema(['INVALID_REQUEST'], 'Request body is invalid'),
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid Bearer token',
    schema: errorSchema(['UNAUTHENTICATED'], 'Authentication is required'),
  })
  @ApiResponse({
    status: 422,
    description: 'Invalid pet data',
    schema: errorSchema(['INVALID_PET'], 'Pet data is invalid'),
  })
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
