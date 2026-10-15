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
    RecordPetVeterinaryVisit,
    InvalidVeterinaryVisitReasonError,
    InvalidVeterinaryVisitDateError,
    InvalidVeterinaryVisitDiagnosisError,
    InvalidVeterinaryVisitObservationsError,
    PetNotFoundError,
    type RecordedPetVeterinaryVisit,
} from '../../../application/record-pet-veterinary-visit/record-pet-veterinary-visit';
import {
    veterinaryVisitPetIdSchema,
    recordPetVeterinaryVisitSchema,
    recordPetVeterinaryVisitQuerySchema,
} from '../schemas/record-pet-veterinary-visit.schema';
import {
    recordPetVeterinaryVisitRequestSchema,
    recordedPetVeterinaryVisitResponseSchema,
} from '../schemas/openapi.schemas';

@Controller('pets/:petId/health/veterinary-visits')
@ApiTags('Health')
@ApiBearerAuth()
export class PetVeterinaryVisitsController {
    constructor(private readonly recordPetVeterinaryVisit: RecordPetVeterinaryVisit) {}

    @Post()
    @UseGuards(AuthenticationGuard)
    @ApiOperation({
        summary: 'Record a pet veterinary visit',
        description:
            'Active owners and collaborators may record a veterinary visit for an ACTIVE pet. Archived pets are read-only. Visit date is required and cannot be later than today UTC. Optional diagnosis and observations accept omission or null; supplied text is trimmed and nonempty. Duplicate records are allowed. Authorship identifies the authenticated account. No query parameters are accepted. Authentication precedes HTTP validation; domain values are validated before transactional Pet access.',
    })
    @ApiParam({
        name: 'petId',
        description: 'Non-nil pet UUID',
        schema: { type: 'string', format: 'uuid' },
    })
    @ApiBody({ schema: recordPetVeterinaryVisitRequestSchema })
    @ApiResponse({
        status: 201,
        description: 'Recorded pet veterinary visit',
        schema: recordedPetVeterinaryVisitResponseSchema,
    })
    @ApiResponse({
        status: 400,
        description: 'Invalid path, body, query, reason, visit date, diagnosis, or observations',
        schema: {
            oneOf: [
                errorSchema(['INVALID_REQUEST'], 'Request body is invalid'),
                errorSchema(
                    ['INVALID_VETERINARY_VISIT_REASON'],
                    'Veterinary visit reason cannot be empty',
                ),
                errorSchema(
                    ['INVALID_VETERINARY_VISIT_DATE'],
                    'Visit date cannot be in the future',
                ),
                errorSchema(
                    ['INVALID_VETERINARY_VISIT_DIAGNOSIS'],
                    'Veterinary visit diagnosis cannot be empty',
                ),
                errorSchema(
                    ['INVALID_VETERINARY_VISIT_OBSERVATIONS'],
                    'Veterinary visit observations cannot be empty',
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
        description: 'Pet missing, archived, or inaccessible',
        schema: errorSchema(['PET_NOT_FOUND'], 'Pet was not found'),
    })
    async create(
        @CurrentAccountId() authenticatedAccountId: string,
        @Param('petId') petId: string,
        @Body() body: unknown,
        @Query() query: unknown,
    ): Promise<RecordedPetVeterinaryVisit> {
        const parsedPetId = veterinaryVisitPetIdSchema.safeParse(petId);

        if (!parsedPetId.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Pet id is invalid',
            });
        }

        const parsedBody = recordPetVeterinaryVisitSchema.safeParse(body);

        if (!parsedBody.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request body is invalid',
            });
        }

        if (!recordPetVeterinaryVisitQuerySchema.safeParse(query).success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request query is invalid',
            });
        }

        try {
            return await this.recordPetVeterinaryVisit.execute({
                ...parsedBody.data,
                petId: parsedPetId.data,
                authenticatedAccountId,
            });
        } catch (error: unknown) {
            if (error instanceof PetNotFoundError) {
                throw new NotFoundException({
                    code: 'PET_NOT_FOUND',
                    message: error.message,
                });
            }

            if (error instanceof InvalidVeterinaryVisitReasonError) {
                throw new BadRequestException({
                    code: 'INVALID_VETERINARY_VISIT_REASON',
                    message: error.message,
                });
            }

            if (error instanceof InvalidVeterinaryVisitDateError) {
                throw new BadRequestException({
                    code: 'INVALID_VETERINARY_VISIT_DATE',
                    message: error.message,
                });
            }

            if (error instanceof InvalidVeterinaryVisitDiagnosisError) {
                throw new BadRequestException({
                    code: 'INVALID_VETERINARY_VISIT_DIAGNOSIS',
                    message: error.message,
                });
            }

            if (error instanceof InvalidVeterinaryVisitObservationsError) {
                throw new BadRequestException({
                    code: 'INVALID_VETERINARY_VISIT_OBSERVATIONS',
                    message: error.message,
                });
            }

            throw error;
        }
    }
}
