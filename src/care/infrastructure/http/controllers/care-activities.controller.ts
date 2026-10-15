import {
    BadRequestException,
    Body,
    Controller,
    NotFoundException,
    Param,
    Post,
    Query,
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
import { AuthenticationGuard } from '../../../../identity/infrastructure/http/authentication/authentication.guard';
import { CurrentAccountId } from '../../../../identity/infrastructure/http/decorators/current-account-id.decorator';
import { errorSchema } from '../../../../infrastructure/http/openapi-error.schema';
import {
    CompleteCareActivity,
    type CompletedCareActivity,
    PetNotFoundError,
    CareRoutineNotFoundError,
    InvalidActivityCompletedAtError,
    InvalidActivityTimezoneError,
    InvalidActivityNotesError,
} from '../../../application/complete-care-activity/complete-care-activity';
import { careRoutinePetIdSchema } from '../schemas/create-care-routine.schema';
import { careRoutineIdSchema } from '../schemas/update-care-routine.schema';
import {
    completeCareActivitySchema,
    completeCareActivityQuerySchema,
} from '../schemas/complete-care-activity.schema';
import {
    completeCareActivityRequestSchema,
    completedCareActivityResponseSchema,
} from '../schemas/openapi.schemas';

@Controller('pets/:petId/care/routines/:routineId/activities')
@ApiTags('Care')
@ApiBearerAuth()
export class CareActivitiesController {
    constructor(private readonly completeCareActivity: CompleteCareActivity) {}

    @Post()
    @UseGuards(AuthenticationGuard)
    @ApiOperation({
        summary: 'Record a completed care activity',
        description:
            'Active owners and collaborators may record activities on ACTIVE pets regardless of routine authorship. Archived pets are read-only. Supply a completedAt UTC instant no later than now and the recorder’s IANA timezone. completedBy comes from authentication. Optional notes accept omission/null. Identical requests create independent activities. No query parameters are accepted. Authentication precedes HTTP validation, including parser failures; domain validation precedes transactional access. Pet access is checked before pet-scoped routine lookup. Technical timestamps are omitted. Local day is computed from completedAt in the recorded timezone; no missed activities or schedule evaluation are stored.',
    })
    @ApiParam({
        name: 'petId',
        description: 'Non-nil pet UUID',
        schema: { type: 'string', format: 'uuid' },
    })
    @ApiParam({
        name: 'routineId',
        description: 'Non-nil routine UUID',
        schema: { type: 'string', format: 'uuid' },
    })
    @ApiBody({ schema: completeCareActivityRequestSchema })
    @ApiResponse({
        status: 201,
        description: 'Recorded care activity',
        schema: completedCareActivityResponseSchema,
    })
    @ApiResponse({
        status: 400,
        description: 'Invalid path, body, query or activity values',
        schema: {
            oneOf: [
                errorSchema(['INVALID_REQUEST'], 'Request body is invalid'),
                errorSchema(
                    ['INVALID_ACTIVITY_COMPLETED_AT'],
                    'Activity completedAt cannot be in the future',
                ),
                errorSchema(
                    ['INVALID_ACTIVITY_TIMEZONE'],
                    'Activity timezone must be an IANA timezone',
                ),
                errorSchema(['INVALID_ACTIVITY_NOTES'], 'Activity notes cannot be empty'),
            ],
        },
    })
    @ApiResponse({
        status: 401,
        description: 'Missing or invalid Bearer token',
        schema: errorSchema(['UNAUTHENTICATED'], 'Authentication is required'),
    })
    @ApiResponse({
        status: 404,
        description: 'Pet missing, archived or inaccessible, or pet-scoped routine missing',
        schema: errorSchema(
            ['PET_NOT_FOUND', 'CARE_ROUTINE_NOT_FOUND'],
            'Pet or care routine was not found',
        ),
    })
    async complete(
        @CurrentAccountId() authenticatedAccountId: string,
        @Param('petId') petId: string,
        @Param('routineId') routineId: string,
        @Body() body: unknown,
        @Query() query: unknown,
    ): Promise<CompletedCareActivity> {
        const parsedPetId = careRoutinePetIdSchema.safeParse(petId);

        if (!parsedPetId.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Pet id is invalid',
            });
        }

        const parsedRoutineId = careRoutineIdSchema.safeParse(routineId);

        if (!parsedRoutineId.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Routine id is invalid',
            });
        }

        const parsedBody = completeCareActivitySchema.safeParse(body);

        if (!parsedBody.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request body is invalid',
            });
        }

        if (!completeCareActivityQuerySchema.safeParse(query).success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request query is invalid',
            });
        }

        try {
            return await this.completeCareActivity.execute({
                routineId: parsedRoutineId.data,
                ...parsedBody.data,
                petId: parsedPetId.data,
                authenticatedAccountId,
            });
        } catch (error: unknown) {
            if (error instanceof PetNotFoundError) {
                throw new NotFoundException({ code: 'PET_NOT_FOUND', message: error.message });
            }

            if (error instanceof CareRoutineNotFoundError) {
                throw new NotFoundException({
                    code: 'CARE_ROUTINE_NOT_FOUND',
                    message: error.message,
                });
            }

            if (error instanceof InvalidActivityCompletedAtError) {
                throw new BadRequestException({
                    code: 'INVALID_ACTIVITY_COMPLETED_AT',
                    message: error.message,
                });
            }

            if (error instanceof InvalidActivityTimezoneError) {
                throw new BadRequestException({
                    code: 'INVALID_ACTIVITY_TIMEZONE',
                    message: error.message,
                });
            }

            if (error instanceof InvalidActivityNotesError) {
                throw new BadRequestException({
                    code: 'INVALID_ACTIVITY_NOTES',
                    message: error.message,
                });
            }

            throw error;
        }
    }
}
