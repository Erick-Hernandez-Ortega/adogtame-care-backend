import {
  RemoveCollaborator,
  PetMemberNotFoundError,
  OwnerRemovalNotSupportedError,
} from '../../../application/remove-collaborator/remove-collaborator';
import {
  PetMemberInactiveError,
  PromoteCollaboratorToOwner,
} from '../../../application/promote-collaborator-to-owner/promote-collaborator-to-owner';
import {
  promoteCollaboratorBodySchema,
  promoteCollaboratorMembershipIdSchema,
  promoteCollaboratorPetIdSchema,
  promoteCollaboratorQuerySchema,
} from '../schemas/promote-collaborator.schema';
import {
  removeCollaboratorPetIdSchema,
  removeCollaboratorMembershipIdSchema,
  removeCollaboratorQuerySchema,
  removeCollaboratorBodySchema,
} from '../schemas/remove-collaborator.schema';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
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
import type { Request } from 'express';
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
import {
  ListPetMembers,
  type PetMembers,
} from '../../../application/list-pet-members/list-pet-members';
import {
  listPetMembersIdSchema,
  listPetMembersQuerySchema,
} from '../schemas/list-pet-members.schema';
import { ListMyPets } from '../../../application/list-my-pets/list-my-pets';
import {
  LeavePet,
  LastOwnerCannotLeaveError,
} from '../../../application/leave-pet/leave-pet';
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
  InvalidPetProfileError,
  UpdatePetProfile,
} from '../../../application/update-pet-profile/update-pet-profile';
import {
  registerPetSchema,
  type RegisterPetRequest,
} from '../schemas/register-pet.schema';
import { petIdSchema } from '../schemas/get-pet-detail.schema';
import {
  emptyLeavePetBodySchema,
  leavePetIdSchema,
  leavePetQuerySchema,
} from '../schemas/leave-pet.schema';
import {
  inviteCollaboratorSchema,
  type InviteCollaboratorRequest,
} from '../schemas/invite-collaborator.schema';
import {
  createdInvitationResponseSchema,
  inviteCollaboratorRequestSchema,
  petDetailResponseSchema,
  petMembersResponseSchema,
  petSummaryResponseSchema,
  registeredPetResponseSchema,
  registerPetRequestSchema,
  updatePetProfileRequestSchema,
} from '../schemas/openapi.schemas';
import {
  updatePetProfileIdSchema,
  updatePetProfileSchema,
  type UpdatePetProfileRequest,
} from '../schemas/update-pet-profile.schema';

@Controller('pets')
@ApiTags('Pets')
@ApiBearerAuth()
export class PetsController {
  constructor(
    private readonly removeCollaborator: RemoveCollaborator,
    private readonly promoteCollaboratorToOwner: PromoteCollaboratorToOwner,
    private readonly registerPet: RegisterPet,
    private readonly listMyPets: ListMyPets,
    private readonly getPetDetail: GetPetDetail,
    private readonly listPetMembers: ListPetMembers,
    private readonly updatePetProfile: UpdatePetProfile,
    private readonly inviteCollaborator: InviteCollaborator,
    private readonly leavePet: LeavePet,
  ) {}

  @Post(':petId/members/:membershipId/promote')
  @UseGuards(AuthenticationGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Promote a pet collaborator to owner',
    description:
      'An active owner of an active pet may promote an active collaborator. The existing membership retains its identity and account. Repeating the request for an active owner, including self-target, succeeds without an update. Inactive memberships cannot be promoted or reactivated. No query parameters are accepted; the body must be absent or empty.',
  })
  @ApiParam({
    name: 'petId',
    description: 'Non-nil pet UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiParam({
    name: 'membershipId',
    description: 'Non-nil membership UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiResponse({ status: 204, description: 'Member is an active owner' })
  @ApiResponse({
    status: 400,
    description: 'Invalid path, unexpected query parameters, or nonempty body',
    schema: errorSchema(['INVALID_REQUEST'], 'Request path is invalid'),
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid Bearer token',
    schema: errorSchema(['UNAUTHENTICATED'], 'Authentication is required'),
  })
  @ApiResponse({
    status: 404,
    description:
      'Pet is missing, archived, or inaccessible to an active owner; or target member is missing from the accessible pet',
    schema: {
      oneOf: [
        errorSchema(['PET_NOT_FOUND'], 'Pet was not found'),
        errorSchema(['PET_MEMBER_NOT_FOUND'], 'Pet member was not found'),
      ],
    },
  })
  @ApiResponse({
    status: 409,
    description: 'Pet member is inactive',
    schema: errorSchema(['PET_MEMBER_INACTIVE'], 'Pet member is inactive'),
  })
  async promoteMember(
    @CurrentAccountId() requesterAccountId: string,
    @Param('petId') petId: string,
    @Param('membershipId') membershipId: string,
    @Query() query: unknown,
    @Body() body: unknown,
  ): Promise<void> {
    const parsedPetId = promoteCollaboratorPetIdSchema.safeParse(petId);
    const parsedMembershipId =
      promoteCollaboratorMembershipIdSchema.safeParse(membershipId);
    if (!parsedPetId.success || !parsedMembershipId.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request path is invalid',
      });
    }
    if (!promoteCollaboratorQuerySchema.safeParse(query).success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request query is invalid',
      });
    }
    if (
      body !== undefined &&
      !promoteCollaboratorBodySchema.safeParse(body).success
    ) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request body is invalid',
      });
    }
    try {
      await this.promoteCollaboratorToOwner.execute({
        requesterAccountId,
        petId: parsedPetId.data,
        targetMembershipId: parsedMembershipId.data,
      });
    } catch (error: unknown) {
      if (error instanceof PetNotFoundError)
        throw new NotFoundException({
          code: 'PET_NOT_FOUND',
          message: error.message,
        });
      if (error instanceof PetMemberNotFoundError)
        throw new NotFoundException({
          code: 'PET_MEMBER_NOT_FOUND',
          message: error.message,
        });
      if (error instanceof PetMemberInactiveError)
        throw new ConflictException({
          code: 'PET_MEMBER_INACTIVE',
          message: error.message,
        });
      throw error;
    }
  }

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

  @Get(':petId/members')
  @UseGuards(AuthenticationGuard)
  @ApiOperation({
    summary: 'List current pet members',
    description:
      'Active owners and collaborators may read members of active or archived pets. Only active memberships are returned, including the requester. Owners appear first, followed by creation date and membership ID ascending. No query parameters are accepted.',
  })
  @ApiParam({
    name: 'petId',
    description: 'Non-nil pet UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiResponse({
    status: 200,
    description: 'Current pet members',
    schema: petMembersResponseSchema,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid pet UUID or unexpected query parameters',
    schema: errorSchema(['INVALID_REQUEST'], 'Request query is invalid'),
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
  async members(
    @CurrentAccountId() accountId: string,
    @Param('petId') petId: string,
    @Query() query: unknown,
  ): Promise<PetMembers> {
    const parsedId = listPetMembersIdSchema.safeParse(petId);
    if (!parsedId.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Pet id is invalid',
      });
    }
    if (!listPetMembersQuerySchema.safeParse(query).success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request query is invalid',
      });
    }
    try {
      return await this.listPetMembers.execute(parsedId.data, accountId);
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

  @Delete(':petId/members/:membershipId')
  @UseGuards(AuthenticationGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a pet collaborator',
    description:
      'An active owner of an active pet may remove collaborator access. The membership is preserved internally. Repeating removal of an inactive collaborator succeeds without an update. Owners cannot be removed. No query parameters are accepted; the body must be absent or empty.',
  })
  @ApiParam({
    name: 'petId',
    description: 'Non-nil pet UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiParam({
    name: 'membershipId',
    description: 'Non-nil membership UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiResponse({
    status: 204,
    description: 'Collaborator access removed or already inactive',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid path, unexpected query parameters, or nonempty body',
    schema: errorSchema(['INVALID_REQUEST'], 'Request path is invalid'),
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid Bearer token',
    schema: errorSchema(['UNAUTHENTICATED'], 'Authentication is required'),
  })
  @ApiResponse({
    status: 404,
    description:
      'Pet is missing, archived, or inaccessible to an active owner; or target member is missing from the accessible pet',
    schema: {
      oneOf: [
        errorSchema(['PET_NOT_FOUND'], 'Pet was not found'),
        errorSchema(['PET_MEMBER_NOT_FOUND'], 'Pet member was not found'),
      ],
    },
  })
  @ApiResponse({
    status: 409,
    description: 'Owner removal is not supported, including self-removal',
    schema: errorSchema(
      ['OWNER_REMOVAL_NOT_SUPPORTED'],
      'Owner removal is not supported',
    ),
  })
  async removeMember(
    @CurrentAccountId() requesterAccountId: string,
    @Param('petId') petId: string,
    @Param('membershipId') membershipId: string,
    @Query() query: unknown,
    @Body() body: unknown,
  ): Promise<void> {
    const parsedPetId = removeCollaboratorPetIdSchema.safeParse(petId);
    const parsedMembershipId =
      removeCollaboratorMembershipIdSchema.safeParse(membershipId);
    if (!parsedPetId.success || !parsedMembershipId.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request path is invalid',
      });
    }
    if (!removeCollaboratorQuerySchema.safeParse(query).success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request query is invalid',
      });
    }
    if (
      body !== undefined &&
      !removeCollaboratorBodySchema.safeParse(body).success
    ) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request body is invalid',
      });
    }
    try {
      await this.removeCollaborator.execute({
        requesterAccountId,
        petId: parsedPetId.data,
        targetMembershipId: parsedMembershipId.data,
      });
    } catch (error: unknown) {
      if (error instanceof PetNotFoundError)
        throw new NotFoundException({
          code: 'PET_NOT_FOUND',
          message: error.message,
        });
      if (error instanceof PetMemberNotFoundError)
        throw new NotFoundException({
          code: 'PET_MEMBER_NOT_FOUND',
          message: error.message,
        });
      if (error instanceof OwnerRemovalNotSupportedError)
        throw new ConflictException({
          code: 'OWNER_REMOVAL_NOT_SUPPORTED',
          message: error.message,
        });
      throw error;
    }
  }

  @Patch(':petId')
  @UseGuards(AuthenticationGuard)
  @ApiOperation({
    summary: 'Correct a pet profile',
    description:
      'Only an active owner can correct the profile of an active pet. Omitted fields are preserved; null clears optional text fields.',
  })
  @ApiParam({
    name: 'petId',
    description: 'Non-nil pet UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBody({ schema: updatePetProfileRequestSchema })
  @ApiResponse({
    status: 200,
    description: 'Corrected pet profile and current account role',
    schema: petDetailResponseSchema,
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
    description: 'Pet is missing or current account is not an active owner',
    schema: errorSchema(['PET_NOT_FOUND'], 'Pet was not found'),
  })
  @ApiResponse({
    status: 422,
    description: 'Pet profile violates domain invariants',
    schema: errorSchema(['INVALID_PET'], 'Pet data is invalid'),
  })
  async updateProfile(
    @CurrentAccountId() accountId: string,
    @Param('petId') petId: string,
    @Body() body: unknown,
  ): Promise<PetDetail> {
    const parsedId = updatePetProfileIdSchema.safeParse(petId);
    if (!parsedId.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Pet id is invalid',
      });
    }
    const parsedBody = updatePetProfileSchema.safeParse(body);
    if (!parsedBody.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request body is invalid',
      });
    }
    const request: UpdatePetProfileRequest = parsedBody.data;
    try {
      return await this.updatePetProfile.execute({
        ...request,
        petId: parsedId.data,
        authenticatedAccountId: accountId,
      });
    } catch (error: unknown) {
      if (error instanceof PetNotFoundError) {
        throw new NotFoundException({
          code: 'PET_NOT_FOUND',
          message: error.message,
        });
      }
      if (error instanceof InvalidPetProfileError) {
        throw new UnprocessableEntityException({
          code: 'INVALID_PET',
          message: error.message,
        });
      }
      throw error;
    }
  }

  @Post(':petId/leave')
  @UseGuards(AuthenticationGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Leave a pet',
    description:
      'Members may leave active or archived pets. An active owner may leave only if another active owner remains. Inactive memberships succeed without an update. No query parameters are accepted; the body must be absent or empty.',
  })
  @ApiParam({
    name: 'petId',
    description: 'Pet UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiResponse({
    status: 204,
    description: 'Membership is inactive; no response body',
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid or nil pet UUID, unexpected query parameters, or nonempty request body',
    schema: errorSchema(['INVALID_REQUEST'], 'Pet id is invalid'),
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid Bearer token',
    schema: errorSchema(['UNAUTHENTICATED'], 'Authentication is required'),
  })
  @ApiResponse({
    status: 404,
    description: 'Pet or membership is missing',
    schema: errorSchema(['PET_NOT_FOUND'], 'Pet was not found'),
  })
  @ApiResponse({
    status: 409,
    description: 'Last owner cannot leave a pet',
    schema: errorSchema(
      ['LAST_OWNER_CANNOT_LEAVE'],
      'Last owner cannot leave a pet',
    ),
  })
  async leave(
    @CurrentAccountId() accountId: string,
    @Param('petId') petId: string,
    @Req() request: Request,
  ): Promise<void> {
    const body: unknown = request.body as unknown;
    const parsedId = leavePetIdSchema.safeParse(petId);
    if (!parsedId.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Pet id is invalid',
      });
    }
    if (!leavePetQuerySchema.safeParse(request.query).success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request query is invalid',
      });
    }
    if (
      body !== undefined &&
      !emptyLeavePetBodySchema.safeParse(body).success
    ) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request body is invalid',
      });
    }
    try {
      return await this.leavePet.execute(parsedId.data, accountId);
    } catch (error: unknown) {
      if (error instanceof PetNotFoundError) {
        throw new NotFoundException({
          code: 'PET_NOT_FOUND',
          message: error.message,
        });
      }
      if (error instanceof LastOwnerCannotLeaveError) {
        throw new ConflictException({
          code: 'LAST_OWNER_CANNOT_LEAVE',
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
