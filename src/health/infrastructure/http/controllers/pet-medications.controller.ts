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

@ApiTags('Health')
@ApiBearerAuth()
@Controller('pets/:petId/health/medications')
export class PetMedicationsController {
    constructor(
        private readonly recordPetMedication: RecordPetMedication,
        private readonly listPetMedications: ListPetMedications,
        private readonly updatePetMedication: UpdatePetMedication,
    ) {}

    @Get()
    @UseGuards(AuthenticationGuard)
    @ApiOperation({
        summary: 'List registered pet medications',
        description:
            'Active owners and collaborators may read all registered medications of active or archived pets regardless of authorship. Results are ordered by technical creation timestamp and medication ID descending, not by start date or planned end date. An accessible pet without medications returns an empty items array. All nullable fields are always present as null when unknown. There are no filters or pagination, and no query parameters are accepted. Dosage and frequency remain reported free text; dates do not infer clinical status or dose administration.',
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
            'Active owners and collaborators may record reported medication information for an active pet. This does not verify a veterinary prescription or track dose administration. Dosage and frequency are free text without pharmacological validation or calculations. Start date is the indicated or reported start and does not prove that the first dose was administered. Planned end date is exclusively the expected end and does not confirm actual treatment completion. Both dates may be unknown or future; when both exist, planned end date must be on or after start date. No clinical status is inferred. Duplicate records with independent identities are allowed. Authorship identifies the authenticated account. No query parameters are accepted. Authentication precedes HTTP validation, followed by Pet access and domain validation.',
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
            'Active owners and collaborators of active pets may correct registered medication information regardless of authorship. The PATCH is strict and partial: omission preserves values, explicit null clears optional fields, and name is non-nullable. Future civil dates are allowed; the resulting planned end must be on or after the resulting start when both exist. Equivalent normalized corrections return 200 without a physical UPDATE or timestamp changes. This is not a new prescription, dose administration, completion or discontinuation. No query parameters are accepted. Errors follow authentication, HTTP structure, Pet access, medication lookup, then domain validation.',
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

            throw error;
        }
    }
}
