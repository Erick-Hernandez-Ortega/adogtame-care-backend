import {
  BadRequestException,
  ConflictException,
  Controller,
  GoneException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticationGuard } from '../../../../identity/infrastructure/http/authentication/authentication.guard';
import { CurrentAccountId } from '../../../../identity/infrastructure/http/decorators/current-account-id.decorator';
import { errorSchema } from '../../../../infrastructure/http/openapi-error.schema';
import {
  AcceptInvitation,
  type AcceptedPetInvitation,
  InvitationExpiredError,
  InvitationNotAcceptableError,
  InvitationNotFoundError,
  InvitationNotPendingError,
} from '../../../application/accept-invitation/accept-invitation';
import {
  RejectInvitation,
  type RejectedPetInvitation,
  RejectInvitationExpiredError,
  RejectInvitationNotFoundError,
  RejectInvitationNotPendingError,
} from '../../../application/reject-invitation/reject-invitation';
import {
  emptyAcceptInvitationBodySchema,
  invitationIdSchema,
} from '../schemas/accept-invitation.schema';
import {
  emptyRejectInvitationBodySchema,
  rejectInvitationIdSchema,
} from '../schemas/reject-invitation.schema';
import {
  acceptedInvitationResponseSchema,
  rejectedInvitationResponseSchema,
} from '../schemas/openapi.schemas';

@Controller('pet-invitations')
@ApiTags('Pet Invitations')
@ApiBearerAuth()
export class PetInvitationsController {
  constructor(
    private readonly acceptInvitation: AcceptInvitation,
    private readonly rejectInvitation: RejectInvitation,
  ) {}

  @Post(':invitationId/accept')
  @UseGuards(AuthenticationGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept a pet invitation',
    description:
      'Only the account whose email matches the invitation can accept it. Repeating a successful acceptance returns the same result.',
  })
  @ApiParam({
    name: 'invitationId',
    description: 'Invitation UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiResponse({
    status: 200,
    description: 'Invitation accepted',
    schema: acceptedInvitationResponseSchema,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid invitation UUID or nonempty request body',
    schema: errorSchema(['INVALID_REQUEST'], 'Invitation id is invalid'),
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid Bearer token',
    schema: errorSchema(['UNAUTHENTICATED'], 'Authentication is required'),
  })
  @ApiResponse({
    status: 404,
    description: 'Invitation missing or addressed to another account',
    schema: errorSchema(['INVITATION_NOT_FOUND'], 'Invitation was not found'),
  })
  @ApiResponse({
    status: 409,
    description: 'Invitation not pending or pet archived',
    schema: errorSchema(
      ['INVITATION_NOT_PENDING', 'INVITATION_NOT_ACCEPTABLE'],
      'Invitation is not pending',
    ),
  })
  @ApiResponse({
    status: 410,
    description: 'Invitation expired',
    schema: errorSchema(['INVITATION_EXPIRED'], 'Invitation has expired'),
  })
  async accept(
    @CurrentAccountId() accountId: string,
    @Param('invitationId') invitationId: string,
    @Req() request: Request,
  ): Promise<AcceptedPetInvitation> {
    const body: unknown = request.body as unknown;
    const parsedId = invitationIdSchema.safeParse(invitationId);
    if (!parsedId.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Invitation id is invalid',
      });
    }

    if (
      body !== undefined &&
      !emptyAcceptInvitationBodySchema.safeParse(body).success
    ) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request body is invalid',
      });
    }

    try {
      return await this.acceptInvitation.execute(parsedId.data, accountId);
    } catch (error: unknown) {
      if (error instanceof InvitationNotFoundError) {
        throw new NotFoundException({
          code: 'INVITATION_NOT_FOUND',
          message: error.message,
        });
      }
      if (error instanceof InvitationExpiredError) {
        throw new GoneException({
          code: 'INVITATION_EXPIRED',
          message: error.message,
        });
      }
      if (error instanceof InvitationNotPendingError) {
        throw new ConflictException({
          code: 'INVITATION_NOT_PENDING',
          message: error.message,
        });
      }
      if (error instanceof InvitationNotAcceptableError) {
        throw new ConflictException({
          code: 'INVITATION_NOT_ACCEPTABLE',
          message: error.message,
        });
      }
      throw error;
    }
  }

  @Post(':invitationId/reject')
  @UseGuards(AuthenticationGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject a pet invitation',
    description:
      'Only the account whose email matches the invitation can reject it. Repeating a successful rejection returns the same result, even if the pet is archived.',
  })
  @ApiParam({
    name: 'invitationId',
    description: 'Invitation UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiResponse({
    status: 200,
    description: 'Invitation rejected',
    schema: rejectedInvitationResponseSchema,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid invitation UUID or nonempty request body',
    schema: errorSchema(['INVALID_REQUEST'], 'Invitation id is invalid'),
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid Bearer token',
    schema: errorSchema(['UNAUTHENTICATED'], 'Authentication is required'),
  })
  @ApiResponse({
    status: 404,
    description: 'Invitation missing or addressed to another account',
    schema: errorSchema(['INVITATION_NOT_FOUND'], 'Invitation was not found'),
  })
  @ApiResponse({
    status: 409,
    description: 'Invitation was accepted or cancelled',
    schema: errorSchema(
      ['INVITATION_NOT_PENDING'],
      'Invitation is not pending',
    ),
  })
  @ApiResponse({
    status: 410,
    description: 'Invitation expired',
    schema: errorSchema(['INVITATION_EXPIRED'], 'Invitation has expired'),
  })
  async reject(
    @CurrentAccountId() accountId: string,
    @Param('invitationId') invitationId: string,
    @Req() request: Request,
  ): Promise<RejectedPetInvitation> {
    const body: unknown = request.body as unknown;
    const parsedId = rejectInvitationIdSchema.safeParse(invitationId);
    if (!parsedId.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Invitation id is invalid',
      });
    }

    if (
      body !== undefined &&
      !emptyRejectInvitationBodySchema.safeParse(body).success
    ) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request body is invalid',
      });
    }

    try {
      return await this.rejectInvitation.execute(parsedId.data, accountId);
    } catch (error: unknown) {
      if (error instanceof RejectInvitationNotFoundError) {
        throw new NotFoundException({
          code: 'INVITATION_NOT_FOUND',
          message: error.message,
        });
      }
      if (error instanceof RejectInvitationExpiredError) {
        throw new GoneException({
          code: 'INVITATION_EXPIRED',
          message: error.message,
        });
      }
      if (error instanceof RejectInvitationNotPendingError) {
        throw new ConflictException({
          code: 'INVITATION_NOT_PENDING',
          message: error.message,
        });
      }
      throw error;
    }
  }
}
