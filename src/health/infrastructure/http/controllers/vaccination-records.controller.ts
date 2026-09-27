import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
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
  recordVaccinationRequestSchema,
  recordedVaccinationResponseSchema,
} from '../schemas/openapi.schemas';

@Controller('pets/:petId/health/vaccination-records')
@ApiTags('Health')
@ApiBearerAuth()
export class VaccinationRecordsController {
  constructor(private readonly recordVaccination: RecordVaccination) {}

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
