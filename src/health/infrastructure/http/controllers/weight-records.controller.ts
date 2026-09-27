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
  InvalidMeasuredDateError,
  InvalidWeightError,
  PetNotFoundError,
  RecordPetWeight,
  type RecordedPetWeight,
} from '../../../application/record-pet-weight/record-pet-weight';
import {
  recordPetWeightSchema,
  weightRecordPetIdSchema,
  type RecordPetWeightRequest,
} from '../schemas/record-pet-weight.schema';
import {
  recordedPetWeightResponseSchema,
  recordPetWeightRequestSchema,
} from '../schemas/openapi.schemas';

@Controller('pets/:petId/health/weight-records')
@ApiTags('Health')
@ApiBearerAuth()
export class WeightRecordsController {
  constructor(private readonly recordPetWeight: RecordPetWeight) {}

  @Post()
  @UseGuards(AuthenticationGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Record a pet weight measurement',
    description:
      'An active owner or collaborator may record weight for an active pet. Measured date cannot be later than the current UTC date.',
  })
  @ApiParam({
    name: 'petId',
    description: 'Pet UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBody({
    schema: recordPetWeightRequestSchema,
    examples: {
      weight: {
        value: { weightKg: '12.3456', measuredDate: '2026-09-26' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Weight measurement recorded',
    schema: recordedPetWeightResponseSchema,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request, weight, or measured date',
    schema: {
      oneOf: [
        errorSchema(['INVALID_REQUEST'], 'Request body is invalid'),
        errorSchema(['INVALID_WEIGHT'], 'Weight must be greater than zero'),
        errorSchema(
          ['INVALID_MEASURED_DATE'],
          'Measured date cannot be in the future',
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
  ): Promise<RecordedPetWeight> {
    const parsedPetId = weightRecordPetIdSchema.safeParse(petId);
    if (!parsedPetId.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Pet id is invalid',
      });
    }
    const parsedBody = recordPetWeightSchema.safeParse(body);
    if (!parsedBody.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request body is invalid',
      });
    }

    const request: RecordPetWeightRequest = parsedBody.data;
    try {
      return await this.recordPetWeight.execute({
        petId: parsedPetId.data,
        weightKg: request.weightKg,
        measuredDate: request.measuredDate,
        authenticatedAccountId,
      });
    } catch (error: unknown) {
      if (error instanceof InvalidWeightError) {
        throw new BadRequestException({
          code: 'INVALID_WEIGHT',
          message: error.message,
        });
      }
      if (error instanceof InvalidMeasuredDateError) {
        throw new BadRequestException({
          code: 'INVALID_MEASURED_DATE',
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
