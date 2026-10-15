import {
    UpdatePetVeterinaryVisit,
    PetVeterinaryVisitNotFoundError,
    type UpdatedPetVeterinaryVisit,
} from '../../../application/update-pet-veterinary-visit/update-pet-veterinary-visit';
import {
    veterinaryVisitIdSchema,
    updatePetVeterinaryVisitSchema,
} from '../schemas/update-pet-veterinary-visit.schema';
import {
    updatePetVeterinaryVisitRequestSchema,
    updatedPetVeterinaryVisitResponseSchema,
} from '../schemas/openapi.schemas';
import {
    ListPetVeterinaryVisits,
    PetNotFoundError as ListPetVeterinaryVisitsPetNotFoundError,
    type PetVeterinaryVisits,
} from '../../../application/list-pet-veterinary-visits/list-pet-veterinary-visits';
import { listPetVeterinaryVisitsQuerySchema } from '../schemas/list-pet-veterinary-visits.schema';
import { petVeterinaryVisitsResponseSchema } from '../schemas/openapi.schemas';
import {
    BadRequestException,
    Body,
    Controller,
    Get,
    NotFoundException,
    Param,
    Post,
    Patch,
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
    constructor(
        private readonly updatePetVeterinaryVisit: UpdatePetVeterinaryVisit,
        private readonly recordPetVeterinaryVisit: RecordPetVeterinaryVisit,
        private readonly listPetVeterinaryVisits: ListPetVeterinaryVisits,
    ) {}

    @Patch(':visitId')
    @UseGuards(AuthenticationGuard)
    @ApiOperation({
        summary: 'Correct a registered pet veterinary visit',
        description:
            'Active owners and collaborators of an ACTIVE pet may correct visits regardless of original authorship. Archived pets are read-only. Include at least one of visitDate, reason, diagnosis or observations. Omitted fields are preserved; null clears diagnosis or observations. Explicit visit dates must be valid calendar dates no later than today UTC sampled after locks. Identity and original author are preserved. A normalized no-op returns the current representation without an UPDATE or timestamp change. No query parameters are accepted. Authentication precedes HTTP validation, including parser failures. Authorization and target resolution precede semantic validation.',
    })
    @ApiParam({
        name: 'petId',
        description: 'Non-nil pet UUID',
        schema: { type: 'string', format: 'uuid' },
    })
    @ApiParam({
        name: 'visitId',
        description: 'Non-nil veterinary visit UUID',
        schema: { type: 'string', format: 'uuid' },
    })
    @ApiBody({ schema: updatePetVeterinaryVisitRequestSchema })
    @ApiResponse({
        status: 200,
        description: 'Complete corrected or unchanged visit',
        schema: updatedPetVeterinaryVisitResponseSchema,
    })
    @ApiResponse({
        status: 400,
        description: 'Invalid request structure or clinical values',
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
        description:
            'Pet missing, archived or inaccessible; visit missing or belongs to another pet',
        schema: {
            oneOf: [
                errorSchema(['PET_NOT_FOUND'], 'Pet was not found'),
                errorSchema(
                    ['PET_VETERINARY_VISIT_NOT_FOUND'],
                    'Pet veterinary visit was not found',
                ),
            ],
        },
    })
    async update(
        @CurrentAccountId() authenticatedAccountId: string,
        @Param('petId') petId: string,
        @Param('visitId') visitId: string,
        @Body() body: unknown,
        @Query() query: unknown,
    ): Promise<UpdatedPetVeterinaryVisit> {
        const parsedPetId = veterinaryVisitPetIdSchema.safeParse(petId);
        const parsedVisitId = veterinaryVisitIdSchema.safeParse(visitId);

        if (!parsedPetId.success || !parsedVisitId.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request path is invalid',
            });
        }

        const parsedBody = updatePetVeterinaryVisitSchema.safeParse(body);

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
            return await this.updatePetVeterinaryVisit.execute({
                ...parsedBody.data,
                petId: parsedPetId.data,
                visitId: parsedVisitId.data,
                authenticatedAccountId,
            });
        } catch (error: unknown) {
            if (error instanceof PetNotFoundError) {
                throw new NotFoundException({
                    code: 'PET_NOT_FOUND',
                    message: error.message,
                });
            }

            if (error instanceof PetVeterinaryVisitNotFoundError) {
                throw new NotFoundException({
                    code: 'PET_VETERINARY_VISIT_NOT_FOUND',
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

    @Get()
    @UseGuards(AuthenticationGuard)
    @ApiOperation({
        summary: 'List registered pet veterinary visits',
        description:
            'Active owners and collaborators may read all visits of ACTIVE or ARCHIVED pets. Visit dates appear newest first; ties use technical creation timestamp and visit ID descending. Technical timestamps are not clinical dates. An accessible pet without visits returns an empty items array. No query parameters are accepted. Authentication precedes HTTP validation.',
    })
    @ApiParam({
        name: 'petId',
        description: 'Non-nil pet UUID',
        schema: { type: 'string', format: 'uuid' },
    })
    @ApiResponse({
        status: 200,
        description: 'All registered pet veterinary visits',
        schema: petVeterinaryVisitsResponseSchema,
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
    ): Promise<PetVeterinaryVisits> {
        const parsedPetId = veterinaryVisitPetIdSchema.safeParse(petId);

        if (!parsedPetId.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Pet id is invalid',
            });
        }

        if (!listPetVeterinaryVisitsQuerySchema.safeParse(query).success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request query is invalid',
            });
        }

        try {
            return await this.listPetVeterinaryVisits.execute({
                petId: parsedPetId.data,
                authenticatedAccountId,
            });
        } catch (error: unknown) {
            if (error instanceof ListPetVeterinaryVisitsPetNotFoundError) {
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
