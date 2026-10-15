import { ApiPagination, validatePage } from '../../../../infrastructure/http/pagination';
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
    GetCareSummary,
    careSummaryScope,
    PetNotFoundError,
    type CareSummary,
} from '../../../application/get-care-summary/get-care-summary';
import { careRoutinePetIdSchema } from '../schemas/create-care-routine.schema';
import { careSummaryQuerySchema } from '../schemas/care-summary.schema';
import { careSummaryResponseSchema } from '../schemas/openapi.schemas';

@Controller('pets/:petId/care/summary')
@ApiTags('Care')
@ApiBearerAuth()
@ApiResponse({
    status: 413,
    description: 'Request body exceeds the 100 KB parser limit; authentication is checked first',
    schema: errorSchema(['INVALID_REQUEST'], 'Request body is too large'),
})
export class CareSummaryController {
    constructor(private readonly getCareSummary: GetCareSummary) {}

    @Get()
    @ApiPagination()
    @UseGuards(AuthenticationGuard)
    @ApiOperation({
        summary: 'Get expected and completed care summary',
        description:
            'ACTIVE owners and collaborators may read ACTIVE or ARCHIVED pets. Required inclusive from/to local dates span at most 31 days. Uses CURRENT frequency and timezone, without history. Days before local creation are omitted. DAILY expects timesPerPeriod each day. WEEKLY selected weekdays divide the target evenly, assigning remainder to earliest ISO weekdays (Monday first). Other weekdays expect zero. WEEKLY without weekdays reports whole overlapping ISO weeks, including counts outside the requested dates, with weekStart Monday; creation week expects zero, earlier weeks are omitted. Completions use each activity’s stored timezone. Missed is max(expected - completed, 0), computed without writes. Suggested times do not affect counts. Routines are paginated by creation time and ID descending, matching the routine list. Unknown or wrong-pet routineId returns empty items after pet authorization. Authentication precedes validation and parser errors.',
    })
    @ApiParam({
        name: 'petId',
        description: 'Non-nil pet UUID',
        schema: { type: 'string', format: 'uuid' },
    })
    @ApiQuery({
        name: 'from',
        required: true,
        description:
            'Inclusive local day lower bound (years 0001–9999); maximum 31 days including both bounds',
        schema: { type: 'string', format: 'date' },
    })
    @ApiQuery({
        name: 'to',
        required: true,
        description: 'Inclusive local day upper bound (years 0001–9999)',
        schema: { type: 'string', format: 'date' },
    })
    @ApiQuery({
        name: 'routineId',
        required: false,
        description: 'Non-nil routine UUID; filters routines within this pet',
        schema: { type: 'string', format: 'uuid' },
    })
    @ApiResponse({
        status: 200,
        description: 'Paginated routine summaries; empty when no routines match',
        schema: careSummaryResponseSchema,
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
    ): Promise<CareSummary> {
        const parsedPetId = careRoutinePetIdSchema.safeParse(petId);

        if (!parsedPetId.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Pet id is invalid',
            });
        }

        const parsedQuery = careSummaryQuerySchema.safeParse(query);

        if (!parsedQuery.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request query is invalid',
            });
        }

        const summaryQuery = {
            ...parsedQuery.data,
            petId: parsedPetId.data,
            authenticatedAccountId,
        };

        validatePage(parsedQuery.data, careSummaryScope(summaryQuery));

        try {
            return await this.getCareSummary.execute({
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
