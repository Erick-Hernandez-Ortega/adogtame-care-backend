import {
    CompletePetMedication,
    InvalidMedicationEndedDateError,
    InvalidMedicationDiscontinuationReasonError,
    PetMedicationLifecycleConflictError,
} from '../../../application/complete-pet-medication/complete-pet-medication';
import { DiscontinuePetMedication } from '../../../application/discontinue-pet-medication/discontinue-pet-medication';
import { ReopenPetMedication } from '../../../application/reopen-pet-medication/reopen-pet-medication';
import {
    completePetMedicationSchema,
    discontinuePetMedicationSchema,
    reopenPetMedicationSchema,
} from '../schemas/complete-pet-medication.schema';
import {
    completePetMedicationRequestSchema,
    discontinuePetMedicationRequestSchema,
} from '../schemas/openapi.schemas';
import {
    BadRequestException,
    ConflictException,
    Body,
    Controller,
    Delete,
    HttpCode,
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
import {
    ListPetMedications,
    PetNotFoundError as ListPetMedicationsPetNotFoundError,
    type PetMedications,
} from '../../../application/list-pet-medications/list-pet-medications';
import { listPetMedicationsQuerySchema } from '../schemas/list-pet-medications.schema';
import {
    RecordPetMedication,
    PetNotFoundError,
    type RecordedPetMedication,
    InvalidMedicationNameError,
    InvalidMedicationDosageError,
    InvalidMedicationFrequencyError,
    InvalidMedicationStartDateError,
    InvalidMedicationPlannedEndDateError,
    InvalidMedicationNotesError,
} from '../../../application/record-pet-medication/record-pet-medication';
import { AuthenticationGuard } from '../../../../identity/infrastructure/http/authentication/authentication.guard';
import { CurrentAccountId } from '../../../../identity/infrastructure/http/decorators/current-account-id.decorator';
import { errorSchema } from '../../../../infrastructure/http/openapi-error.schema';
import {
    medicationPetIdSchema,
    recordPetMedicationSchema,
    recordPetMedicationQuerySchema,
} from '../schemas/record-pet-medication.schema';
import {
    recordPetMedicationRequestSchema,
    recordedPetMedicationResponseSchema,
    petMedicationsResponseSchema,
    updatePetMedicationRequestSchema,
} from '../schemas/openapi.schemas';

import {
    UpdatePetMedication,
    PetMedicationNotFoundError,
    type UpdatedPetMedication,
} from '../../../application/update-pet-medication/update-pet-medication';
import {
    medicationIdSchema,
    updatePetMedicationSchema,
    updatePetMedicationQuerySchema,
} from '../schemas/update-pet-medication.schema';

import { DeletePetMedication } from '../../../application/delete-pet-medication/delete-pet-medication';
import { deletePetMedicationSchema } from '../schemas/delete-pet-medication.schema';

@ApiTags('Health')
@ApiBearerAuth()
@Controller('pets/:petId/health/medications')
export class PetMedicationsController {
    constructor(
        private readonly recordPetMedication: RecordPetMedication,
        private readonly listPetMedications: ListPetMedications,
        private readonly updatePetMedication: UpdatePetMedication,
        private readonly deletePetMedication: DeletePetMedication,
        private readonly completePetMedication: CompletePetMedication,
        private readonly discontinuePetMedication: DiscontinuePetMedication,
        private readonly reopenPetMedication: ReopenPetMedication,
    ) {}

    @Get()
    @UseGuards(AuthenticationGuard)
    @ApiOperation({
        summary: 'List registered pet medications',
        description:
            'Active owners and collaborators may read all registered medications of active or archived pets regardless of authorship. All lifecycle states are included; OPEN means no closure recorded and closed states are reports, not clinical confirmation. Results are ordered by technical creation timestamp and medication ID descending, not by start date or planned end date. An accessible pet without medications returns an empty items array. All nullable fields are always present as null when unknown. There are no filters or pagination, and no query parameters are accepted. Dosage and frequency remain reported free text; dates do not infer clinical status or dose administration.',
    })
    @ApiParam({
        name: 'petId',
        description: 'Non-nil pet UUID',
        schema: { type: 'string', format: 'uuid' },
    })
    @ApiResponse({
        status: 200,
        description: 'All registered pet medications',
        schema: petMedicationsResponseSchema,
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
    ): Promise<PetMedications> {
        const parsedPetId = medicationPetIdSchema.safeParse(petId);

        if (!parsedPetId.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Pet id is invalid',
            });
        }

        if (!listPetMedicationsQuerySchema.safeParse(query).success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request query is invalid',
            });
        }

        try {
            return await this.listPetMedications.execute({
                petId: parsedPetId.data,
                authenticatedAccountId,
            });
        } catch (error: unknown) {
            if (error instanceof ListPetMedicationsPetNotFoundError) {
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
        summary: 'Record indicated pet medication',
        description:
            'Active owners and collaborators may record reported medication information for an active pet. This does not verify a veterinary prescription or track dose administration. Dosage and frequency are free text without pharmacological validation or calculations. Start date is the indicated or reported start and does not prove that the first dose was administered. Planned end date is exclusively the expected end and does not confirm actual treatment completion. Both dates may be unknown or future; when both exist, planned end date must be on or after start date. No clinical status is inferred. New records are OPEN (no closure recorded), with null endedDate and discontinuationReason; this does not assert current use. Duplicate records with independent identities are allowed. Authorship identifies the authenticated account. No query parameters are accepted. Authentication precedes HTTP validation, followed by Pet access and domain validation.',
    })
    @ApiParam({
        name: 'petId',
        description: 'Non-nil pet UUID',
        schema: { type: 'string', format: 'uuid' },
    })
    @ApiBody({ required: true, schema: recordPetMedicationRequestSchema })
    @ApiResponse({
        status: 201,
        description: 'Recorded indicated pet medication',
        schema: recordedPetMedicationResponseSchema,
    })
    @ApiResponse({
        status: 400,
        description: 'Invalid HTTP structure or medication information',
        schema: {
            oneOf: [
                errorSchema(['INVALID_REQUEST'], 'Request body is invalid'),
                errorSchema(['INVALID_MEDICATION_NAME'], 'Medication name cannot be empty'),
                errorSchema(['INVALID_MEDICATION_DOSAGE'], 'Medication dosage cannot be empty'),
                errorSchema(
                    ['INVALID_MEDICATION_FREQUENCY'],
                    'Medication frequency cannot be empty',
                ),
                errorSchema(
                    ['INVALID_MEDICATION_START_DATE'],
                    'Medication date must be a valid calendar date',
                ),
                errorSchema(
                    ['INVALID_MEDICATION_PLANNED_END_DATE'],
                    'Planned end date cannot be before start date',
                ),
                errorSchema(['INVALID_MEDICATION_NOTES'], 'Medication notes cannot be empty'),
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
    ): Promise<RecordedPetMedication> {
        const parsedPetId = medicationPetIdSchema.safeParse(petId);

        if (!parsedPetId.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Pet id is invalid',
            });
        }

        const parsedBody = recordPetMedicationSchema.safeParse(body);

        if (!parsedBody.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request body is invalid',
            });
        }

        if (!recordPetMedicationQuerySchema.safeParse(query).success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request query is invalid',
            });
        }

        try {
            return await this.recordPetMedication.execute({
                ...parsedBody.data,
                petId: parsedPetId.data,
                authenticatedAccountId,
            });
        } catch (error: unknown) {
            if (error instanceof PetNotFoundError) {
                throw new NotFoundException({ code: 'PET_NOT_FOUND', message: error.message });
            }

            if (error instanceof InvalidMedicationNameError) {
                throw new BadRequestException({
                    code: 'INVALID_MEDICATION_NAME',
                    message: error.message,
                });
            }

            if (error instanceof InvalidMedicationDosageError) {
                throw new BadRequestException({
                    code: 'INVALID_MEDICATION_DOSAGE',
                    message: error.message,
                });
            }

            if (error instanceof InvalidMedicationFrequencyError) {
                throw new BadRequestException({
                    code: 'INVALID_MEDICATION_FREQUENCY',
                    message: error.message,
                });
            }

            if (error instanceof InvalidMedicationStartDateError) {
                throw new BadRequestException({
                    code: 'INVALID_MEDICATION_START_DATE',
                    message: error.message,
                });
            }

            if (error instanceof InvalidMedicationPlannedEndDateError) {
                throw new BadRequestException({
                    code: 'INVALID_MEDICATION_PLANNED_END_DATE',
                    message: error.message,
                });
            }

            if (error instanceof InvalidMedicationNotesError) {
                throw new BadRequestException({
                    code: 'INVALID_MEDICATION_NOTES',
                    message: error.message,
                });
            }

            throw error;
        }
    }

    @Patch(':medicationId')
    @UseGuards(AuthenticationGuard)
    @ApiOperation({
        summary: 'Update registered pet medication',
        description:
            'Active owners and collaborators of active pets may correct registered medication information regardless of authorship. The PATCH is strict and partial: omission preserves values, explicit null clears optional fields, and name is non-nullable. Future civil dates are allowed; the resulting planned end must be on or after the resulting start when both exist. Equivalent normalized corrections return 200 without a physical UPDATE or timestamp changes. PATCH preserves status and corrects closure details only in their applicable closed states; it does not create a new prescription or report dose administration. No query parameters are accepted. Errors follow authentication, HTTP structure, Pet access, medication lookup, then domain validation.',
    })
    @ApiParam({
        name: 'petId',
        description: 'Non-nil pet UUID',
        schema: { type: 'string', format: 'uuid' },
    })
    @ApiParam({
        name: 'medicationId',
        description: 'Non-nil medication UUID',
        schema: { type: 'string', format: 'uuid' },
    })
    @ApiBody({ required: true, schema: updatePetMedicationRequestSchema })
    @ApiResponse({
        status: 200,
        description: 'Complete updated medication, including equivalent corrections',
        schema: recordedPetMedicationResponseSchema,
    })
    @ApiResponse({
        status: 400,
        description: 'Invalid HTTP structure or medication information',
        schema: {
            oneOf: [
                errorSchema(['INVALID_MEDICATION_ENDED_DATE'], 'Ended date is invalid'),
                errorSchema(
                    ['INVALID_MEDICATION_DISCONTINUATION_REASON'],
                    'Discontinuation reason is invalid',
                ),
                errorSchema(['INVALID_REQUEST'], 'Request body is invalid'),
                errorSchema(['INVALID_MEDICATION_NAME'], 'Medication name cannot be empty'),
                errorSchema(['INVALID_MEDICATION_DOSAGE'], 'Medication dosage cannot be empty'),
                errorSchema(
                    ['INVALID_MEDICATION_FREQUENCY'],
                    'Medication frequency cannot be empty',
                ),
                errorSchema(
                    ['INVALID_MEDICATION_START_DATE'],
                    'Medication date must be a valid calendar date',
                ),
                errorSchema(
                    ['INVALID_MEDICATION_PLANNED_END_DATE'],
                    'Planned end date cannot be before start date',
                ),
                errorSchema(['INVALID_MEDICATION_NOTES'], 'Medication notes cannot be empty'),
            ],
        },
    })
    @ApiResponse({
        status: 409,
        description: 'Closure fields do not apply to the current status',
        schema: errorSchema(
            ['PET_MEDICATION_LIFECYCLE_CONFLICT'],
            'Medication lifecycle action conflicts with the current report',
        ),
    })
    @ApiResponse({
        status: 401,
        description: 'Missing or invalid Bearer token',
        schema: errorSchema(['UNAUTHENTICATED'], 'Authentication is required'),
    })
    @ApiResponse({
        status: 404,
        description:
            'Pet missing, archived, or inaccessible; medication missing or belonging to another pet',
        schema: {
            oneOf: [
                errorSchema(['PET_NOT_FOUND'], 'Pet was not found'),
                errorSchema(['PET_MEDICATION_NOT_FOUND'], 'Pet medication was not found'),
            ],
        },
    })
    async update(
        @CurrentAccountId() authenticatedAccountId: string,
        @Param('petId') petId: string,
        @Param('medicationId') medicationId: string,
        @Body() body: unknown,
        @Query() query: unknown,
    ): Promise<UpdatedPetMedication> {
        const parsedPetId = medicationPetIdSchema.safeParse(petId);

        if (!parsedPetId.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Pet id is invalid',
            });
        }

        const parsedMedicationId = medicationIdSchema.safeParse(medicationId);

        if (!parsedMedicationId.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Medication id is invalid',
            });
        }

        const parsedBody = updatePetMedicationSchema.safeParse(body);

        if (!parsedBody.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request body is invalid',
            });
        }

        if (!updatePetMedicationQuerySchema.safeParse(query).success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request query is invalid',
            });
        }

        try {
            return await this.updatePetMedication.execute({
                ...parsedBody.data,
                petId: parsedPetId.data,
                medicationId: parsedMedicationId.data,
                authenticatedAccountId,
            });
        } catch (error: unknown) {
            if (error instanceof PetNotFoundError) {
                throw new NotFoundException({ code: 'PET_NOT_FOUND', message: error.message });
            }

            if (error instanceof PetMedicationNotFoundError) {
                throw new NotFoundException({
                    code: 'PET_MEDICATION_NOT_FOUND',
                    message: error.message,
                });
            }

            if (error instanceof InvalidMedicationNameError) {
                throw new BadRequestException({
                    code: 'INVALID_MEDICATION_NAME',
                    message: error.message,
                });
            }

            if (error instanceof InvalidMedicationDosageError) {
                throw new BadRequestException({
                    code: 'INVALID_MEDICATION_DOSAGE',
                    message: error.message,
                });
            }

            if (error instanceof InvalidMedicationFrequencyError) {
                throw new BadRequestException({
                    code: 'INVALID_MEDICATION_FREQUENCY',
                    message: error.message,
                });
            }

            if (error instanceof InvalidMedicationStartDateError) {
                throw new BadRequestException({
                    code: 'INVALID_MEDICATION_START_DATE',
                    message: error.message,
                });
            }

            if (error instanceof InvalidMedicationPlannedEndDateError) {
                throw new BadRequestException({
                    code: 'INVALID_MEDICATION_PLANNED_END_DATE',
                    message: error.message,
                });
            }

            if (error instanceof InvalidMedicationNotesError) {
                throw new BadRequestException({
                    code: 'INVALID_MEDICATION_NOTES',
                    message: error.message,
                });
            }

            this.throwLifecycleError(error);

            throw error;
        }
    }

    @Post(':medicationId/complete')
    @HttpCode(200)
    @UseGuards(AuthenticationGuard)
    @ApiOperation({
        summary: 'Complete registered pet medication',
        description:
            'Report completion, not clinical confirmation or dose administration. Requires an explicit nullable endedDate; known dates cannot be future or before a known indicated start. Equivalent repeated reports return 200 without UPDATE; different reports or DISCONTINUED state return 409. Active owners and collaborators of ACTIVE pets may act regardless of authorship. Archived pets are read-only. No query parameters. Authentication precedes HTTP structure, Pet access, medication lookup and domain validation. Identity and original authorship are preserved.',
    })
    @ApiParam({ name: 'petId', schema: { type: 'string', format: 'uuid' } })
    @ApiParam({ name: 'medicationId', schema: { type: 'string', format: 'uuid' } })
    @ApiBody({ required: true, schema: completePetMedicationRequestSchema })
    @ApiResponse({
        status: 200,
        description: 'Current medication report',
        schema: recordedPetMedicationResponseSchema,
    })
    @ApiResponse({
        status: 400,
        description: 'Invalid request or reported closure information',
        schema: {
            oneOf: [
                errorSchema(['INVALID_REQUEST'], 'Request is invalid'),
                errorSchema(['INVALID_MEDICATION_ENDED_DATE'], 'Ended date is invalid'),
            ],
        },
    })
    @ApiResponse({
        status: 401,
        description: 'Authentication required',
        schema: errorSchema(['UNAUTHENTICATED'], 'Authentication is required'),
    })
    @ApiResponse({
        status: 404,
        description: 'Pet or medication missing or inaccessible',
        schema: {
            oneOf: [
                errorSchema(['PET_NOT_FOUND'], 'Pet was not found'),
                errorSchema(['PET_MEDICATION_NOT_FOUND'], 'Pet medication was not found'),
            ],
        },
    })
    @ApiResponse({
        status: 409,
        description: 'Incompatible state or different repeated report',
        schema: errorSchema(
            ['PET_MEDICATION_LIFECYCLE_CONFLICT'],
            'Medication lifecycle action conflicts with the current report',
        ),
    })
    async complete(
        @CurrentAccountId() authenticatedAccountId: string,
        @Param('petId') petId: string,
        @Param('medicationId') medicationId: string,
        @Body() body: unknown,
        @Query() query: unknown,
    ): Promise<RecordedPetMedication> {
        const access = this.lifecycleAccess(petId, medicationId, authenticatedAccountId);
        const parsedBody = completePetMedicationSchema.safeParse(body);

        if (!parsedBody.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request body is invalid',
            });
        }

        if (!updatePetMedicationQuerySchema.safeParse(query).success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request query is invalid',
            });
        }

        try {
            return await this.completePetMedication.execute({ ...access, ...parsedBody.data });
        } catch (error: unknown) {
            this.throwLifecycleError(error);

            throw error;
        }
    }

    @Post(':medicationId/discontinue')
    @HttpCode(200)
    @UseGuards(AuthenticationGuard)
    @ApiOperation({
        summary: 'Discontinue registered pet medication',
        description:
            'Report discontinuation, including withdrawal before the indicated start. Requires an explicit nullable endedDate; known dates cannot be future. Reason is optional. Equivalent normalized repeated reports return 200 without UPDATE; different reports or COMPLETED state return 409. Active owners and collaborators of ACTIVE pets may act regardless of authorship. Archived pets are read-only. No query parameters. Authentication precedes HTTP structure, Pet access, medication lookup and domain validation. Identity and original authorship are preserved.',
    })
    @ApiParam({ name: 'petId', schema: { type: 'string', format: 'uuid' } })
    @ApiParam({ name: 'medicationId', schema: { type: 'string', format: 'uuid' } })
    @ApiBody({ required: true, schema: discontinuePetMedicationRequestSchema })
    @ApiResponse({
        status: 200,
        description: 'Current medication report',
        schema: recordedPetMedicationResponseSchema,
    })
    @ApiResponse({
        status: 400,
        description: 'Invalid request or reported closure information',
        schema: {
            oneOf: [
                errorSchema(['INVALID_REQUEST'], 'Request is invalid'),
                errorSchema(['INVALID_MEDICATION_ENDED_DATE'], 'Ended date is invalid'),
                errorSchema(
                    ['INVALID_MEDICATION_DISCONTINUATION_REASON'],
                    'Discontinuation reason is invalid',
                ),
            ],
        },
    })
    @ApiResponse({
        status: 401,
        description: 'Authentication required',
        schema: errorSchema(['UNAUTHENTICATED'], 'Authentication is required'),
    })
    @ApiResponse({
        status: 404,
        description: 'Pet or medication missing or inaccessible',
        schema: {
            oneOf: [
                errorSchema(['PET_NOT_FOUND'], 'Pet was not found'),
                errorSchema(['PET_MEDICATION_NOT_FOUND'], 'Pet medication was not found'),
            ],
        },
    })
    @ApiResponse({
        status: 409,
        description: 'Incompatible state or different repeated report',
        schema: errorSchema(
            ['PET_MEDICATION_LIFECYCLE_CONFLICT'],
            'Medication lifecycle action conflicts with the current report',
        ),
    })
    async discontinue(
        @CurrentAccountId() authenticatedAccountId: string,
        @Param('petId') petId: string,
        @Param('medicationId') medicationId: string,
        @Body() body: unknown,
        @Query() query: unknown,
    ): Promise<RecordedPetMedication> {
        const access = this.lifecycleAccess(petId, medicationId, authenticatedAccountId);
        const parsedBody = discontinuePetMedicationSchema.safeParse(body);

        if (!parsedBody.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request body is invalid',
            });
        }

        if (!updatePetMedicationQuerySchema.safeParse(query).success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request query is invalid',
            });
        }

        try {
            return await this.discontinuePetMedication.execute({ ...access, ...parsedBody.data });
        } catch (error: unknown) {
            this.throwLifecycleError(error);

            throw error;
        }
    }

    @Post(':medicationId/reopen')
    @HttpCode(200)
    @UseGuards(AuthenticationGuard)
    @ApiOperation({
        summary: 'Reopen registered pet medication',
        description:
            'Correct an erroneous closure, not restart treatment. Clear endedDate and discontinuationReason permanently without transition history. OPEN retries return 200 without UPDATE. Accept no body or an empty object. Current-state idempotence does not identify requests across intervening closures. Active owners and collaborators of ACTIVE pets may act regardless of authorship. Archived pets are read-only. No query parameters. Authentication precedes HTTP structure, Pet access, medication lookup and domain validation. Identity and original authorship are preserved.',
    })
    @ApiParam({ name: 'petId', schema: { type: 'string', format: 'uuid' } })
    @ApiParam({ name: 'medicationId', schema: { type: 'string', format: 'uuid' } })
    @ApiBody({
        required: false,
        schema: { type: 'object', additionalProperties: false, maxProperties: 0 },
    })
    @ApiResponse({
        status: 200,
        description: 'Current medication report',
        schema: recordedPetMedicationResponseSchema,
    })
    @ApiResponse({
        status: 400,
        description: 'Invalid path, body or query parameters',
        schema: errorSchema(['INVALID_REQUEST'], 'Request is invalid'),
    })
    @ApiResponse({
        status: 401,
        description: 'Authentication required',
        schema: errorSchema(['UNAUTHENTICATED'], 'Authentication is required'),
    })
    @ApiResponse({
        status: 404,
        description: 'Pet or medication missing or inaccessible',
        schema: {
            oneOf: [
                errorSchema(['PET_NOT_FOUND'], 'Pet was not found'),
                errorSchema(['PET_MEDICATION_NOT_FOUND'], 'Pet medication was not found'),
            ],
        },
    })
    async reopen(
        @CurrentAccountId() authenticatedAccountId: string,
        @Param('petId') petId: string,
        @Param('medicationId') medicationId: string,
        @Body() body: unknown,
        @Query() query: unknown,
    ): Promise<RecordedPetMedication> {
        const access = this.lifecycleAccess(petId, medicationId, authenticatedAccountId);
        const parsedBody = reopenPetMedicationSchema.safeParse(body === undefined ? {} : body);

        if (!parsedBody.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request body is invalid',
            });
        }

        if (!updatePetMedicationQuerySchema.safeParse(query).success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request query is invalid',
            });
        }

        try {
            return await this.reopenPetMedication.execute({ ...access, ...parsedBody.data });
        } catch (error: unknown) {
            this.throwLifecycleError(error);

            throw error;
        }
    }

    @Delete(':medicationId')
    @UseGuards(AuthenticationGuard)
    @HttpCode(204)
    @ApiOperation({
        summary: 'Delete an erroneous pet medication record',
        description:
            'Hard delete permanently removes a medication record recorded in error, without deletion history, tombstones or restoration. It does not represent treatment completion, discontinuation, dose administration, interruption due to adverse effects or a prescription change. Active owners and collaborators may delete records on active pets regardless of original authorship. Archived pets are read-only. A second authorized DELETE returns PET_MEDICATION_NOT_FOUND. No query parameters or functional body are accepted; an absent body or empty JSON object is valid. Errors follow authentication, HTTP structure, Pet access, then medication lookup.',
    })
    @ApiParam({
        name: 'petId',
        description: 'Non-nil pet UUID',
        schema: { type: 'string', format: 'uuid' },
    })
    @ApiParam({
        name: 'medicationId',
        description: 'Non-nil medication UUID',
        schema: { type: 'string', format: 'uuid' },
    })
    @ApiResponse({
        status: 204,
        description: 'Pet medication record permanently deleted',
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
            'Pet missing, archived, or inaccessible; or medication missing from an authorized pet',
        schema: {
            oneOf: [
                errorSchema(['PET_NOT_FOUND'], 'Pet was not found'),
                errorSchema(['PET_MEDICATION_NOT_FOUND'], 'Pet medication was not found'),
            ],
        },
    })
    async delete(
        @CurrentAccountId() authenticatedAccountId: string,
        @Param('petId') petId: string,
        @Param('medicationId') medicationId: string,
        @Query() query: unknown,
        @Body() body: unknown,
    ): Promise<void> {
        const parsedPetId = medicationPetIdSchema.safeParse(petId);
        const parsedMedicationId = medicationIdSchema.safeParse(medicationId);

        if (!parsedPetId.success || !parsedMedicationId.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request path is invalid',
            });
        }

        if (!recordPetMedicationQuerySchema.safeParse(query).success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request query is invalid',
            });
        }

        if (body !== undefined && !deletePetMedicationSchema.safeParse(body).success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Request body is invalid',
            });
        }

        try {
            await this.deletePetMedication.execute({
                petId: parsedPetId.data,
                medicationId: parsedMedicationId.data,
                authenticatedAccountId,
            });
        } catch (error: unknown) {
            if (error instanceof PetMedicationNotFoundError) {
                throw new NotFoundException({
                    code: 'PET_MEDICATION_NOT_FOUND',
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

    private lifecycleAccess(
        petId: string,
        medicationId: string,
        authenticatedAccountId: string,
    ): { petId: string; medicationId: string; authenticatedAccountId: string } {
        const parsedPetId = medicationPetIdSchema.safeParse(petId);
        const parsedMedicationId = medicationIdSchema.safeParse(medicationId);

        if (!parsedPetId.success || !parsedMedicationId.success) {
            throw new BadRequestException({
                code: 'INVALID_REQUEST',
                message: 'Medication path is invalid',
            });
        }

        return {
            petId: parsedPetId.data,
            medicationId: parsedMedicationId.data,
            authenticatedAccountId,
        };
    }

    private throwLifecycleError(error: unknown): void {
        if (error instanceof PetNotFoundError || error instanceof PetMedicationNotFoundError) {
            throw new NotFoundException({
                code:
                    error instanceof PetNotFoundError
                        ? 'PET_NOT_FOUND'
                        : 'PET_MEDICATION_NOT_FOUND',
                message: error.message,
            });
        }

        if (
            error instanceof InvalidMedicationEndedDateError ||
            error instanceof InvalidMedicationDiscontinuationReasonError
        ) {
            throw new BadRequestException({
                code:
                    error instanceof InvalidMedicationEndedDateError
                        ? 'INVALID_MEDICATION_ENDED_DATE'
                        : 'INVALID_MEDICATION_DISCONTINUATION_REASON',
                message: error.message,
            });
        }

        if (error instanceof PetMedicationLifecycleConflictError) {
            throw new ConflictException({
                code: 'PET_MEDICATION_LIFECYCLE_CONFLICT',
                message: error.message,
            });
        }
    }
}
