import {
    BadRequestException,
    Body,
    Controller,
    Get,
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
    CreateCareRoutine,
    type CreatedCareRoutine,
    PetNotFoundError,
    InvalidRoutineTypeError,
    InvalidRoutineTitleError,
    InvalidRoutineInstructionsError,
    InvalidRoutineFrequencyError,
    InvalidRoutineTimezoneError,
} from '../../../application/create-care-routine/create-care-routine';
import {
    careRoutinePetIdSchema,
    createCareRoutineSchema,
    createCareRoutineQuerySchema,
} from '../schemas/create-care-routine.schema';
import {
    createCareRoutineRequestSchema,
    createdCareRoutineResponseSchema,
    careRoutinesResponseSchema,
} from '../schemas/openapi.schemas';
import {
    ListCareRoutines,
    type CareRoutines,
    PetNotFoundError as ListCareRoutinesPetNotFoundError,
} from '../../../application/list-care-routines/list-care-routines';
import { listCareRoutinesQuerySchema } from '../schemas/list-care-routines.schema';

@Controller('pets/:petId/care/routines')
@ApiTags('Care')
@ApiBearerAuth()
export class CareRoutinesController {
    constructor(
        private readonly createCareRoutine: CreateCareRoutine,
        private readonly listCareRoutines: ListCareRoutines,
    ) {}

    @Get()
    @UseGuards(AuthenticationGuard)
    @ApiOperation({
        summary: 'List registered pet care routines',
        description:
            'Active owners and collaborators may read all routines for ACTIVE or ARCHIVED pets. Returns items ordered by creation timestamp then ID descending, including duplicates. No query parameters, pagination, filters or sorting options are accepted. Pet identity comes from the route; technical timestamps are omitted. Suggested times remain local HH:mm in the stored IANA timezone. Reads take no row locks and do not change timestamps. Authentication precedes HTTP validation.',
    })
    @ApiParam({
        name: 'petId',
        description: 'Non-nil pet UUID',
        schema: { type: 'string', format: 'uuid' },
    })
    @ApiResponse({
        status: 200,
        description: 'All registered pet care routines',
        schema: careRoutinesResponseSchema,
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
    async list(
        @CurrentAccountId() authenticatedAccountId: string,
        @Param('petId') petId: string,
        @Query() query: unknown,
    ): Promise<CareRoutines> {
        const parsedPetId = careRoutinePetIdSchema.safeParse(petId);

        if (!parsedPetId.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Pet id is invalid',
            });
        }

        if (!listCareRoutinesQuerySchema.safeParse(query).success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request query is invalid',
            });
        }

        try {
            return await this.listCareRoutines.execute({
                petId: parsedPetId.data,
                authenticatedAccountId,
            });
        } catch (error: unknown) {
            if (error instanceof ListCareRoutinesPetNotFoundError) {
                throw new NotFoundException({
                    code: 'PET_NOT_FOUND',
                    message: error.message,
                });
            }

            throw error;
        }
    }

    @Post()
    @UseGuards(AuthenticationGuard)
    @ApiOperation({
        summary: 'Create a pet care routine',
        description:
            'Active owners and collaborators may create routines for ACTIVE pets. Archived pets are read-only. Supply the creator’s IANA timezone explicitly; suggested times stay local HH:mm. Omitted/null instructions become null; omitted/null suggestion arrays become empty arrays. Duplicate routines are allowed. Authorship comes from authentication. No query parameters are accepted. Authentication precedes HTTP validation, including parser failures; domain values are validated before transactional Pet access. Technical timestamps are not exposed. No activities or reminders are created.',
    })
    @ApiParam({
        name: 'petId',
        description: 'Non-nil pet UUID',
        schema: { type: 'string', format: 'uuid' },
    })
    @ApiBody({ schema: createCareRoutineRequestSchema })
    @ApiResponse({
        status: 201,
        description: 'Created care routine',
        schema: createdCareRoutineResponseSchema,
    })
    @ApiResponse({
        status: 400,
        description: 'Invalid path, body, query or routine values',
        schema: {
            oneOf: [
                errorSchema(['INVALID_REQUEST'], 'Request body is invalid'),
                errorSchema(
                    ['INVALID_ROUTINE_TYPE'],
                    'Routine type must be FEEDING, WALK, HYGIENE or OTHER',
                ),
                errorSchema(['INVALID_ROUTINE_TITLE'], 'Routine title cannot be empty'),
                errorSchema(
                    ['INVALID_ROUTINE_INSTRUCTIONS'],
                    'Routine instructions cannot be empty',
                ),
                errorSchema(
                    ['INVALID_ROUTINE_FREQUENCY'],
                    'Routine times per period must be a positive safe integer',
                ),
                errorSchema(
                    ['INVALID_ROUTINE_TIMEZONE'],
                    'Routine timezone must be an IANA timezone',
                ),
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
        description: 'Pet missing, archived or inaccessible',
        schema: errorSchema(['PET_NOT_FOUND'], 'Pet was not found'),
    })
    async create(
        @CurrentAccountId() authenticatedAccountId: string,
        @Param('petId') petId: string,
        @Body() body: unknown,
        @Query() query: unknown,
    ): Promise<CreatedCareRoutine> {
        const parsedPetId = careRoutinePetIdSchema.safeParse(petId);

        if (!parsedPetId.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Pet id is invalid',
            });
        }

        const parsedBody = createCareRoutineSchema.safeParse(body);

        if (!parsedBody.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request body is invalid',
            });
        }

        if (!createCareRoutineQuerySchema.safeParse(query).success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request query is invalid',
            });
        }

        try {
            return await this.createCareRoutine.execute({
                ...parsedBody.data,
                petId: parsedPetId.data,
                authenticatedAccountId,
            });
        } catch (error: unknown) {
            if (error instanceof PetNotFoundError) {
                throw new NotFoundException({ code: 'PET_NOT_FOUND', message: error.message });
            }

            if (error instanceof InvalidRoutineTypeError) {
                throw new BadRequestException({
                    code: 'INVALID_ROUTINE_TYPE',
                    message: error.message,
                });
            }

            if (error instanceof InvalidRoutineTitleError) {
                throw new BadRequestException({
                    code: 'INVALID_ROUTINE_TITLE',
                    message: error.message,
                });
            }

            if (error instanceof InvalidRoutineInstructionsError) {
                throw new BadRequestException({
                    code: 'INVALID_ROUTINE_INSTRUCTIONS',
                    message: error.message,
                });
            }

            if (error instanceof InvalidRoutineFrequencyError) {
                throw new BadRequestException({
                    code: 'INVALID_ROUTINE_FREQUENCY',
                    message: error.message,
                });
            }

            if (error instanceof InvalidRoutineTimezoneError) {
                throw new BadRequestException({
                    code: 'INVALID_ROUTINE_TIMEZONE',
                    message: error.message,
                });
            }

            throw error;
        }
    }
}
