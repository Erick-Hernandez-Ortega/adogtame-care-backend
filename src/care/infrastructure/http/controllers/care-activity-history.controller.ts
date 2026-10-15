import {
    BadRequestException,
    Controller,
    Get,
    NotFoundException,
    Param,
    Query,
    UseGuards,
} from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiOperation,
    ApiParam,
    ApiQuery,
    ApiResponse,
    ApiTags,
} from '@nestjs/swagger';
import { AuthenticationGuard } from '../../../../identity/infrastructure/http/authentication/authentication.guard';
import { CurrentAccountId } from '../../../../identity/infrastructure/http/decorators/current-account-id.decorator';
import { errorSchema } from '../../../../infrastructure/http/openapi-error.schema';
import {
    ListCareActivities,
    PetNotFoundError,
    type CareActivities,
} from '../../../application/list-care-activities/list-care-activities';
import { careRoutinePetIdSchema } from '../schemas/create-care-routine.schema';
import { listCareActivitiesQuerySchema } from '../schemas/list-care-activities.schema';
import { careActivitiesResponseSchema } from '../schemas/openapi.schemas';

@Controller('pets/:petId/care/activities')
@ApiTags('Care')
@ApiBearerAuth()
export class CareActivityHistoryController {
    constructor(private readonly listCareActivities: ListCareActivities) {}

    @Get()
    @UseGuards(AuthenticationGuard)
    @ApiOperation({
        summary: 'List care activity history',
        description:
            'ACTIVE owners and collaborators may read ACTIVE or ARCHIVED pets. Optional from/to are inclusive local calendar dates in each activity’s recorded timezone, independent of the routine timezone. from must not exceed to. Optional routineId filters within the pet; unknown or wrong-pet routines return empty items after pet authorization. All matching activities are returned ordered by completedAt, creation timestamp (including microseconds), then ID descending. Pet identity and technical timestamps are omitted. No pagination or daily expected/completed summary is provided. Authentication precedes validation, including JSON parser failures. Reads take no row locks and never store missed activities.',
    })
    @ApiParam({
        name: 'petId',
        description: 'Non-nil pet UUID',
        schema: { type: 'string', format: 'uuid' },
    })
    @ApiQuery({
        name: 'from',
        required: false,
        description: 'Inclusive local day lower bound (years 0001–9999)',
        schema: { type: 'string', format: 'date' },
    })
    @ApiQuery({
        name: 'to',
        required: false,
        description: 'Inclusive local day upper bound (years 0001–9999)',
        schema: { type: 'string', format: 'date' },
    })
    @ApiQuery({
        name: 'routineId',
        required: false,
        description: 'Non-nil routine UUID; filters activities within this pet',
        schema: { type: 'string', format: 'uuid' },
    })
    @ApiResponse({
        status: 200,
        description: 'Care activity history, empty when no activities match',
        schema: careActivitiesResponseSchema,
    })
    @ApiResponse({
        status: 400,
        description:
            'Invalid path or query, including unknown or repeated parameters and reversed ranges',
        schema: errorSchema(['INVALID_REQUEST'], 'Request query is invalid'),
    })
    @ApiResponse({
        status: 401,
        description: 'Missing or invalid Bearer token',
        schema: errorSchema(['UNAUTHENTICATED'], 'Authentication is required'),
    })
    @ApiResponse({
        status: 404,
        description: 'Pet missing or inaccessible',
        schema: errorSchema(['PET_NOT_FOUND'], 'Pet was not found'),
    })
    async list(
        @CurrentAccountId() authenticatedAccountId: string,
        @Param('petId') petId: string,
        @Query() query: unknown,
    ): Promise<CareActivities> {
        const parsedPetId = careRoutinePetIdSchema.safeParse(petId);

        if (!parsedPetId.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Pet id is invalid',
            });
        }

        const parsedQuery = listCareActivitiesQuerySchema.safeParse(query);

        if (!parsedQuery.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request query is invalid',
            });
        }

        try {
            return await this.listCareActivities.execute({
                ...parsedQuery.data,
                petId: parsedPetId.data,
                authenticatedAccountId,
            });
        } catch (error: unknown) {
            if (error instanceof PetNotFoundError) {
                throw new NotFoundException({ code: 'PET_NOT_FOUND', message: error.message });
            }

            throw error;
        }
    }
}
