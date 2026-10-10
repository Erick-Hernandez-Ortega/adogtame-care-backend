import { DeletePetMedicalCondition } from '../../../application/delete-pet-medical-condition/delete-pet-medical-condition';
import { deletePetMedicalConditionSchema } from '../schemas/delete-pet-medical-condition.schema';
import { ReopenPetMedicalCondition } from '../../../application/reopen-pet-medical-condition/reopen-pet-medical-condition';
import { reopenPetMedicalConditionSchema } from '../schemas/reopen-pet-medical-condition.schema';
import {
    ResolvePetMedicalCondition,
    InvalidMedicalConditionResolvedDateError,
} from '../../../application/resolve-pet-medical-condition/resolve-pet-medical-condition';
import { resolvePetMedicalConditionSchema } from '../schemas/resolve-pet-medical-condition.schema';
import {
    UpdatePetMedicalCondition,
    PetMedicalConditionNotFoundError,
    type UpdatedPetMedicalCondition,
} from '../../../application/update-pet-medical-condition/update-pet-medical-condition';
import {
    medicalConditionIdSchema,
    updatePetMedicalConditionSchema,
} from '../schemas/update-pet-medical-condition.schema';
import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
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
import {
    ListPetMedicalConditions,
    PetNotFoundError as ListPetMedicalConditionsPetNotFoundError,
    type PetMedicalConditions,
} from '../../../application/list-pet-medical-conditions/list-pet-medical-conditions';
import { listPetMedicalConditionsQuerySchema } from '../schemas/list-pet-medical-conditions.schema';
import { AuthenticationGuard } from '../../../../identity/infrastructure/http/authentication/authentication.guard';
import { CurrentAccountId } from '../../../../identity/infrastructure/http/decorators/current-account-id.decorator';
import { errorSchema } from '../../../../infrastructure/http/openapi-error.schema';
import {
    InvalidMedicalConditionNameError,
    InvalidMedicalConditionDiagnosedDateError,
    InvalidMedicalConditionNotesError,
    PetNotFoundError,
    RecordPetMedicalCondition,
    type RecordedPetMedicalCondition,
} from '../../../application/record-pet-medical-condition/record-pet-medical-condition';
import {
    medicalConditionPetIdSchema,
    recordPetMedicalConditionSchema,
    recordPetMedicalConditionQuerySchema,
} from '../schemas/record-pet-medical-condition.schema';
import {
    resolvePetMedicalConditionRequestSchema,
    reopenedPetMedicalConditionResponseSchema,
    resolvedPetMedicalConditionResponseSchema,
    recordPetMedicalConditionRequestSchema,
    updatePetMedicalConditionRequestSchema,
    updatedPetMedicalConditionResponseSchema,
    recordedPetMedicalConditionResponseSchema,
    petMedicalConditionsResponseSchema,
} from '../schemas/openapi.schemas';

@Controller('pets/:petId/health/medical-conditions')
@ApiTags('Health')
@ApiBearerAuth()
export class PetMedicalConditionsController {
    constructor(
        private readonly deletePetMedicalCondition: DeletePetMedicalCondition,
        private readonly reopenPetMedicalCondition: ReopenPetMedicalCondition,
        private readonly resolvePetMedicalCondition: ResolvePetMedicalCondition,
        private readonly updatePetMedicalCondition: UpdatePetMedicalCondition,
        private readonly recordPetMedicalCondition: RecordPetMedicalCondition,
        private readonly listPetMedicalConditions: ListPetMedicalConditions,
    ) {}

    @Delete(':conditionId')
    @UseGuards(AuthenticationGuard)
    @HttpCode(204)
    @ApiOperation({
        summary: 'Delete an erroneous pet medical condition record',
        description:
            'Hard delete corrects an erroneous record; it does not represent clinical resolution, recovery, relapse, or treatment completion. Active owners and collaborators may delete ACTIVE or RESOLVED conditions on active pets regardless of original authorship. Archived pets are read-only. A second DELETE returns PET_MEDICAL_CONDITION_NOT_FOUND. No query parameters or functional body are accepted; an absent body or empty JSON object is valid.',
    })
    @ApiParam({
        name: 'petId',
        description: 'Non-nil pet UUID',
        schema: { type: 'string', format: 'uuid' },
    })
    @ApiParam({
        name: 'conditionId',
        description: 'Non-nil medical condition UUID',
        schema: { type: 'string', format: 'uuid' },
    })
    @ApiResponse({
        status: 204,
        description: 'Pet medical condition record permanently deleted',
    })
    @ApiResponse({
        status: 400,
        description: 'Invalid path, unexpected query parameters, or nonempty/invalid JSON body',
        schema: errorSchema(['INVALID_REQUEST'], 'Request body is invalid'),
    })
    @ApiResponse({
        status: 401,
        description: 'Missing or invalid Bearer token',
        schema: errorSchema(['UNAUTHENTICATED'], 'Authentication is required'),
    })
    @ApiResponse({
        status: 404,
        description:
            'Pet missing, archived, or inaccessible; or condition missing from an authorized pet',
        schema: {
            oneOf: [
                errorSchema(['PET_NOT_FOUND'], 'Pet was not found'),
                errorSchema(
                    ['PET_MEDICAL_CONDITION_NOT_FOUND'],
                    'Pet medical condition was not found',
                ),
            ],
        },
    })
    async delete(
        @CurrentAccountId() authenticatedAccountId: string,
        @Param('petId') petId: string,
        @Param('conditionId') conditionId: string,
        @Query() query: unknown,
        @Body() body: unknown,
    ): Promise<void> {
        const parsedPetId = medicalConditionPetIdSchema.safeParse(petId);
        const parsedConditionId = medicalConditionIdSchema.safeParse(conditionId);

        if (!parsedPetId.success || !parsedConditionId.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request path is invalid',
            });
        }

        if (!recordPetMedicalConditionQuerySchema.safeParse(query).success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request query is invalid',
            });
        }

        if (body !== undefined && !deletePetMedicalConditionSchema.safeParse(body).success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request body is invalid',
            });
        }

        try {
            await this.deletePetMedicalCondition.execute({
                petId: parsedPetId.data,
                conditionId: parsedConditionId.data,
                authenticatedAccountId,
            });
        } catch (error: unknown) {
            if (error instanceof PetMedicalConditionNotFoundError) {
                throw new NotFoundException({
                    code: 'PET_MEDICAL_CONDITION_NOT_FOUND',
                    message: error.message,
                });
            }

            if (error instanceof PetNotFoundError) {
                throw new NotFoundException({
                    code: 'PET_NOT_FOUND',
                    message: error.message,
                });
            }

            throw error;
        }
    }

    @Post(':conditionId/reopen')
    @HttpCode(200)
    @UseGuards(AuthenticationGuard)
    @ApiOperation({
        summary: 'Correct an erroneous medical condition resolution',
        description:
            'Active owners and collaborators of ACTIVE pets may reopen conditions regardless of authorship. Reopen corrects an erroneous resolution; it does not represent clinical recurrence. RESOLVED becomes ACTIVE and the previous resolvedDate is cleared permanently, without transition history or audit. An authorized retry on ACTIVE returns the current condition without UPDATE or timestamp change. A Reopen after a new Resolve may change the state again. Body must be absent or an empty object. No query parameters are accepted.',
    })
    @ApiParam({
        name: 'petId',
        description: 'Non-nil pet UUID',
        schema: { type: 'string', format: 'uuid' },
    })
    @ApiParam({
        name: 'conditionId',
        description: 'Non-nil medical condition UUID',
        schema: { type: 'string', format: 'uuid' },
    })
    @ApiResponse({
        status: 200,
        description:
            'Complete active condition with resolvedDate null; authorized retries are unchanged',
        schema: reopenedPetMedicalConditionResponseSchema,
    })
    @ApiResponse({
        status: 400,
        description: 'Invalid path, body or query',
        schema: errorSchema(['INVALID_REQUEST'], 'Request body is invalid'),
    })
    @ApiResponse({
        status: 401,
        description: 'Missing or invalid Bearer token',
        schema: errorSchema(['UNAUTHENTICATED'], 'Authentication is required'),
    })
    @ApiResponse({
        status: 404,
        description:
            'Pet missing, archived or inaccessible; condition missing or belongs to another pet',
        schema: {
            oneOf: [
                errorSchema(['PET_NOT_FOUND'], 'Pet was not found'),
                errorSchema(
                    ['PET_MEDICAL_CONDITION_NOT_FOUND'],
                    'Pet medical condition was not found',
                ),
            ],
        },
    })
    async reopen(
        @CurrentAccountId() authenticatedAccountId: string,
        @Param('petId') petId: string,
        @Param('conditionId') conditionId: string,
        @Body() body: unknown,
        @Query() query: unknown,
    ): Promise<UpdatedPetMedicalCondition> {
        const parsedPetId = medicalConditionPetIdSchema.safeParse(petId);
        const parsedConditionId = medicalConditionIdSchema.safeParse(conditionId);

        if (!parsedPetId.success || !parsedConditionId.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request path is invalid',
            });
        }

        const parsedBody = reopenPetMedicalConditionSchema.safeParse(body);

        if (body !== undefined && !parsedBody.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request body is invalid',
            });
        }

        if (!recordPetMedicalConditionQuerySchema.safeParse(query).success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request query is invalid',
            });
        }

        try {
            return await this.reopenPetMedicalCondition.execute({
                petId: parsedPetId.data,
                conditionId: parsedConditionId.data,
                authenticatedAccountId,
            });
        } catch (error: unknown) {
            if (error instanceof PetNotFoundError) {
                throw new NotFoundException({
                    code: 'PET_NOT_FOUND',
                    message: error.message,
                });
            }

            if (error instanceof PetMedicalConditionNotFoundError) {
                throw new NotFoundException({
                    code: 'PET_MEDICAL_CONDITION_NOT_FOUND',
                    message: error.message,
                });
            }

            throw error;
        }
    }

    @Post(':conditionId/resolve')
    @HttpCode(200)
    @UseGuards(AuthenticationGuard)
    @ApiOperation({
        summary: 'Resolve a registered pet medical condition',
        description:
            'Active owners and collaborators of ACTIVE pets may resolve conditions regardless of authorship. resolvedDate is required: an exact civil date no later than today UTC, or null when unknown. No implicit date or ordering relative to diagnosis is imposed. An authorized retry on RESOLVED returns the current condition without UPDATE or timestamp change and never modifies the existing resolution date, even when the newly supplied string is semantically invalid. No query parameters are accepted. Authorization and target lookup precede domain validation.',
    })
    @ApiParam({
        name: 'petId',
        description: 'Non-nil pet UUID',
        schema: { type: 'string', format: 'uuid' },
    })
    @ApiParam({
        name: 'conditionId',
        description: 'Non-nil medical condition UUID',
        schema: { type: 'string', format: 'uuid' },
    })
    @ApiBody({ schema: resolvePetMedicalConditionRequestSchema })
    @ApiResponse({
        status: 200,
        description: 'Complete resolved condition; retries preserve the existing resolution date',
        schema: resolvedPetMedicalConditionResponseSchema,
    })
    @ApiResponse({
        status: 400,
        description: 'Invalid request structure or clinical values',
        schema: {
            oneOf: [
                errorSchema(['INVALID_REQUEST'], 'Request body is invalid'),
                errorSchema(
                    ['INVALID_MEDICAL_CONDITION_RESOLVED_DATE'],
                    'Resolved date cannot be in the future',
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
            'Pet missing, archived or inaccessible; condition missing or belongs to another pet',
        schema: {
            oneOf: [
                errorSchema(['PET_NOT_FOUND'], 'Pet was not found'),
                errorSchema(
                    ['PET_MEDICAL_CONDITION_NOT_FOUND'],
                    'Pet medical condition was not found',
                ),
            ],
        },
    })
    async resolve(
        @CurrentAccountId() authenticatedAccountId: string,
        @Param('petId') petId: string,
        @Param('conditionId') conditionId: string,
        @Body() body: unknown,
        @Query() query: unknown,
    ): Promise<UpdatedPetMedicalCondition> {
        const parsedPetId = medicalConditionPetIdSchema.safeParse(petId);
        const parsedConditionId = medicalConditionIdSchema.safeParse(conditionId);

        if (!parsedPetId.success || !parsedConditionId.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request path is invalid',
            });
        }

        const parsedBody = resolvePetMedicalConditionSchema.safeParse(body);

        if (!parsedBody.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request body is invalid',
            });
        }

        if (!recordPetMedicalConditionQuerySchema.safeParse(query).success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request query is invalid',
            });
        }

        try {
            return await this.resolvePetMedicalCondition.execute({
                ...parsedBody.data,
                petId: parsedPetId.data,
                conditionId: parsedConditionId.data,
                authenticatedAccountId,
            });
        } catch (error: unknown) {
            if (error instanceof PetNotFoundError) {
                throw new NotFoundException({
                    code: 'PET_NOT_FOUND',
                    message: error.message,
                });
            }

            if (error instanceof PetMedicalConditionNotFoundError) {
                throw new NotFoundException({
                    code: 'PET_MEDICAL_CONDITION_NOT_FOUND',
                    message: error.message,
                });
            }

            if (error instanceof InvalidMedicalConditionResolvedDateError) {
                throw new BadRequestException({
                    code: 'INVALID_MEDICAL_CONDITION_RESOLVED_DATE',
                    message: error.message,
                });
            }

            throw error;
        }
    }

    @Patch(':conditionId')
    @UseGuards(AuthenticationGuard)
    @ApiOperation({
        summary: 'Correct a registered pet medical condition',
        description:
            'Active owners and collaborators of an ACTIVE pet may correct ACTIVE or RESOLVED conditions, regardless of original authorship. Identity, original author, status and resolvedDate are preserved: Update does not Resolve or Reopen. Include at least one of name, diagnosedDate or notes. Omitted fields are preserved; null clears date or notes. Diagnosed date is the exact known date of the reported diagnosis, not symptom onset, record creation, owner awareness or proof of professional diagnosis. Explicit dates must be valid calendar dates no later than today UTC sampled after locks. A normalized no-op returns the current representation without an UPDATE or timestamp change. No query parameters are accepted. Authorization and target resolution precede semantic validation.',
    })
    @ApiParam({
        name: 'petId',
        description: 'Non-nil pet UUID',
        schema: { type: 'string', format: 'uuid' },
    })
    @ApiParam({
        name: 'conditionId',
        description: 'Non-nil medical condition UUID',
        schema: { type: 'string', format: 'uuid' },
    })
    @ApiBody({ schema: updatePetMedicalConditionRequestSchema })
    @ApiResponse({
        status: 200,
        description: 'Complete corrected or unchanged condition; status is preserved',
        schema: updatedPetMedicalConditionResponseSchema,
    })
    @ApiResponse({
        status: 400,
        description: 'Invalid request structure or clinical values',
        schema: {
            oneOf: [
                errorSchema(['INVALID_REQUEST'], 'Request body is invalid'),
                errorSchema(
                    ['INVALID_MEDICAL_CONDITION_NAME'],
                    'Medical condition name cannot be empty',
                ),
                errorSchema(
                    ['INVALID_MEDICAL_CONDITION_DIAGNOSED_DATE'],
                    'Diagnosed date cannot be in the future',
                ),
                errorSchema(
                    ['INVALID_MEDICAL_CONDITION_NOTES'],
                    'Medical condition notes cannot be empty',
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
            'Pet missing, archived or inaccessible; condition missing or belongs to another pet',
        schema: {
            oneOf: [
                errorSchema(['PET_NOT_FOUND'], 'Pet was not found'),
                errorSchema(
                    ['PET_MEDICAL_CONDITION_NOT_FOUND'],
                    'Pet medical condition was not found',
                ),
            ],
        },
    })
    async update(
        @CurrentAccountId() authenticatedAccountId: string,
        @Param('petId') petId: string,
        @Param('conditionId') conditionId: string,
        @Body() body: unknown,
        @Query() query: unknown,
    ): Promise<UpdatedPetMedicalCondition> {
        const parsedPetId = medicalConditionPetIdSchema.safeParse(petId);
        const parsedConditionId = medicalConditionIdSchema.safeParse(conditionId);

        if (!parsedPetId.success || !parsedConditionId.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request path is invalid',
            });
        }

        const parsedBody = updatePetMedicalConditionSchema.safeParse(body);

        if (!parsedBody.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request body is invalid',
            });
        }

        if (!recordPetMedicalConditionQuerySchema.safeParse(query).success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request query is invalid',
            });
        }

        try {
            return await this.updatePetMedicalCondition.execute({
                ...parsedBody.data,
                petId: parsedPetId.data,
                conditionId: parsedConditionId.data,
                authenticatedAccountId,
            });
        } catch (error: unknown) {
            if (error instanceof PetNotFoundError) {
                throw new NotFoundException({
                    code: 'PET_NOT_FOUND',
                    message: error.message,
                });
            }

            if (error instanceof PetMedicalConditionNotFoundError) {
                throw new NotFoundException({
                    code: 'PET_MEDICAL_CONDITION_NOT_FOUND',
                    message: error.message,
                });
            }

            if (error instanceof InvalidMedicalConditionNameError) {
                throw new BadRequestException({
                    code: 'INVALID_MEDICAL_CONDITION_NAME',
                    message: error.message,
                });
            }

            if (error instanceof InvalidMedicalConditionDiagnosedDateError) {
                throw new BadRequestException({
                    code: 'INVALID_MEDICAL_CONDITION_DIAGNOSED_DATE',
                    message: error.message,
                });
            }

            if (error instanceof InvalidMedicalConditionNotesError) {
                throw new BadRequestException({
                    code: 'INVALID_MEDICAL_CONDITION_NOTES',
                    message: error.message,
                });
            }

            throw error;
        }
    }

    @Get()
    @UseGuards(AuthenticationGuard)
    @ApiOperation({
        summary: 'List registered pet medical conditions',
        description:
            'Active owners and collaborators may read all ACTIVE and RESOLVED conditions of active or archived pets. Known diagnosis dates appear newest first, unknown dates last; ties use technical creation timestamp and condition ID descending. Technical timestamps are not clinical dates. An accessible pet without conditions returns an empty items array. No query parameters are accepted.',
    })
    @ApiParam({
        name: 'petId',
        description: 'Non-nil pet UUID',
        schema: { type: 'string', format: 'uuid' },
    })
    @ApiResponse({
        status: 200,
        description: 'All registered pet medical conditions',
        schema: petMedicalConditionsResponseSchema,
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
    ): Promise<PetMedicalConditions> {
        const parsedPetId = medicalConditionPetIdSchema.safeParse(petId);

        if (!parsedPetId.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Pet id is invalid',
            });
        }

        if (!listPetMedicalConditionsQuerySchema.safeParse(query).success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request query is invalid',
            });
        }

        try {
            return await this.listPetMedicalConditions.execute({
                petId: parsedPetId.data,
                authenticatedAccountId,
            });
        } catch (error: unknown) {
            if (error instanceof ListPetMedicalConditionsPetNotFoundError) {
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
        summary: 'Record a known pet medical condition',
        description:
            'Active owners and collaborators may record a current condition for an active pet. Records always start ACTIVE; status cannot be supplied. Duplicate entries are allowed. Diagnosed date is the exact known date of the reported diagnosis, not symptom onset or proof of a professional diagnosis. Omit it or send null when unknown or only approximate. Dates cannot be later than today in UTC. Notes are optional. Authorship identifies the authenticated account. No query parameters are accepted. Clinical values are validated before transactional Pet access.',
    })
    @ApiParam({
        name: 'petId',
        description: 'Non-nil pet UUID',
        schema: { type: 'string', format: 'uuid' },
    })
    @ApiBody({ schema: recordPetMedicalConditionRequestSchema })
    @ApiResponse({
        status: 201,
        description: 'Recorded active pet medical condition',
        schema: recordedPetMedicalConditionResponseSchema,
    })
    @ApiResponse({
        status: 400,
        description: 'Invalid path, body, query, name, diagnosed date, or notes',
        schema: {
            oneOf: [
                errorSchema(['INVALID_REQUEST'], 'Request body is invalid'),
                errorSchema(
                    ['INVALID_MEDICAL_CONDITION_NAME'],
                    'Medical condition name cannot be empty',
                ),
                errorSchema(
                    ['INVALID_MEDICAL_CONDITION_DIAGNOSED_DATE'],
                    'Diagnosed date cannot be in the future',
                ),
                errorSchema(
                    ['INVALID_MEDICAL_CONDITION_NOTES'],
                    'Medical condition notes cannot be empty',
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
    ): Promise<RecordedPetMedicalCondition> {
        const parsedPetId = medicalConditionPetIdSchema.safeParse(petId);

        if (!parsedPetId.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Pet id is invalid',
            });
        }

        const parsedBody = recordPetMedicalConditionSchema.safeParse(body);

        if (!parsedBody.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request body is invalid',
            });
        }

        if (!recordPetMedicalConditionQuerySchema.safeParse(query).success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request query is invalid',
            });
        }

        try {
            return await this.recordPetMedicalCondition.execute({
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

            if (error instanceof InvalidMedicalConditionNameError) {
                throw new BadRequestException({
                    code: 'INVALID_MEDICAL_CONDITION_NAME',
                    message: error.message,
                });
            }

            if (error instanceof InvalidMedicalConditionDiagnosedDateError) {
                throw new BadRequestException({
                    code: 'INVALID_MEDICAL_CONDITION_DIAGNOSED_DATE',
                    message: error.message,
                });
            }

            if (error instanceof InvalidMedicalConditionNotesError) {
                throw new BadRequestException({
                    code: 'INVALID_MEDICAL_CONDITION_NOTES',
                    message: error.message,
                });
            }

            throw error;
        }
    }
}
