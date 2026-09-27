import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticationGuard } from '../../../../identity/infrastructure/http/authentication/authentication.guard';
import { CurrentAccountId } from '../../../../identity/infrastructure/http/decorators/current-account-id.decorator';
import { errorSchema } from '../../../../infrastructure/http/openapi-error.schema';
import {
  ListPetVaccinationHistory,
  PetNotFoundError as VaccinationHistoryPetNotFoundError,
  type PetVaccinationHistory,
} from '../../../application/list-pet-vaccination-history/list-pet-vaccination-history';
import { InvalidVaccinationHistoryCursorError } from '../../../application/list-pet-vaccination-history/vaccination-history-cursor';
import {
  InvalidAppliedDateError,
  InvalidNextDueDateError,
  InvalidVaccineNameError,
  PetNotFoundError,
  RecordVaccination,
  type RecordedVaccination,
} from '../../../application/record-vaccination/record-vaccination';
import {
  recordVaccinationSchema,
  vaccinationPetIdSchema,
  type RecordVaccinationRequest,
} from '../schemas/record-vaccination.schema';
import {
  petVaccinationHistoryResponseSchema,
  recordVaccinationRequestSchema,
  recordedVaccinationResponseSchema,
} from '../schemas/openapi.schemas';
import {
  listPetVaccinationHistorySchema,
  type ListPetVaccinationHistoryRequest,
} from '../schemas/list-pet-vaccination-history.schema';

@Controller('pets/:petId/health/vaccination-records')
@ApiTags('Health')
@ApiBearerAuth()
export class VaccinationRecordsController {
  constructor(
    private readonly recordVaccination: RecordVaccination,
    private readonly listPetVaccinationHistory: ListPetVaccinationHistory,
  ) {}

  @Get()
  @UseGuards(AuthenticationGuard)
  @ApiOperation({
    summary: 'List a pet vaccination history',
    description:
      'An active owner or collaborator may read vaccination history for an active or archived pet. Results are ordered by applied date, newest first.',
  })
  @ApiParam({
    name: 'petId',
    description: 'Pet UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Page size (default 20, maximum 100)',
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Opaque cursor returned by the preceding page',
    schema: { type: 'string' },
  })
  @ApiResponse({
    status: 200,
    description: 'Vaccination history page',
    schema: petVaccinationHistoryResponseSchema,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid pet UUID, query parameter, or cursor',
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
  ): Promise<PetVaccinationHistory> {
    const parsedPetId = vaccinationPetIdSchema.safeParse(petId);
    if (!parsedPetId.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Pet id is invalid',
      });
    }
    const parsedQuery = listPetVaccinationHistorySchema.safeParse(query);
    if (!parsedQuery.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request query is invalid',
      });
    }
    const request: ListPetVaccinationHistoryRequest = parsedQuery.data;
    const limit: number =
      request.limit === undefined ? 20 : Number(request.limit);
    if (limit > 100) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request query is invalid',
      });
    }

    try {
      return await this.listPetVaccinationHistory.execute({
        petId: parsedPetId.data,
        authenticatedAccountId,
        limit,
        cursor: request.cursor ?? null,
      });
    } catch (error: unknown) {
      if (error instanceof InvalidVaccinationHistoryCursorError) {
        throw new BadRequestException({
          code: 'INVALID_REQUEST',
          message: 'Cursor is invalid',
        });
      }
      if (error instanceof VaccinationHistoryPetNotFoundError) {
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
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Record a pet vaccination',
    description:
      'An active owner or collaborator may record a vaccination for an active pet. The applied date cannot be later than today UTC; the optional next due date must be after the applied date.',
  })
  @ApiParam({
    name: 'petId',
    description: 'Pet UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBody({
    schema: recordVaccinationRequestSchema,
    examples: {
      scheduled: {
        value: {
          vaccineName: 'Rabies',
          appliedDate: '2026-09-20',
          nextDueDate: '2027-09-20',
        },
      },
      unknownNextDose: {
        value: {
          vaccineName: 'Rabies',
          appliedDate: '2026-09-20',
          nextDueDate: null,
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Vaccination recorded',
    schema: recordedVaccinationResponseSchema,
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid request, vaccine name, applied date, or next due date',
    schema: {
      oneOf: [
        errorSchema(['INVALID_REQUEST'], 'Request body is invalid'),
        errorSchema(['INVALID_VACCINE_NAME'], 'Vaccine name cannot be empty'),
        errorSchema(
          ['INVALID_APPLIED_DATE'],
          'Applied date cannot be in the future',
        ),
        errorSchema(
          ['INVALID_NEXT_DUE_DATE'],
          'Next due date must be after applied date',
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
  ): Promise<RecordedVaccination> {
    const parsedPetId = vaccinationPetIdSchema.safeParse(petId);
    if (!parsedPetId.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Pet id is invalid',
      });
    }
    const parsedBody = recordVaccinationSchema.safeParse(body);
    if (!parsedBody.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request body is invalid',
      });
    }
    const request: RecordVaccinationRequest = parsedBody.data;
    try {
      return await this.recordVaccination.execute({
        petId: parsedPetId.data,
        vaccineName: request.vaccineName,
        appliedDate: request.appliedDate,
        nextDueDate: request.nextDueDate ?? null,
        authenticatedAccountId,
      });
    } catch (error: unknown) {
      if (error instanceof InvalidVaccineNameError) {
        throw new BadRequestException({
          code: 'INVALID_VACCINE_NAME',
          message: error.message,
        });
      }
      if (error instanceof InvalidAppliedDateError) {
        throw new BadRequestException({
          code: 'INVALID_APPLIED_DATE',
          message: error.message,
        });
      }
      if (error instanceof InvalidNextDueDateError) {
        throw new BadRequestException({
          code: 'INVALID_NEXT_DUE_DATE',
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
}
