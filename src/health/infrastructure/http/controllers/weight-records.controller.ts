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
  ListPetWeightHistory,
  PetNotFoundError as WeightHistoryPetNotFoundError,
  type PetWeightHistory,
} from '../../../application/list-pet-weight-history/list-pet-weight-history';
import { InvalidWeightHistoryCursorError } from '../../../application/list-pet-weight-history/weight-history-cursor';
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
  listPetWeightHistorySchema,
  type ListPetWeightHistoryRequest,
} from '../schemas/list-pet-weight-history.schema';
import {
  petWeightHistoryResponseSchema,
  recordedPetWeightResponseSchema,
  recordPetWeightRequestSchema,
} from '../schemas/openapi.schemas';

@Controller('pets/:petId/health/weight-records')
@ApiTags('Health')
@ApiBearerAuth()
export class WeightRecordsController {
  constructor(
    private readonly recordPetWeight: RecordPetWeight,
    private readonly listPetWeightHistory: ListPetWeightHistory,
  ) {}

  @Get()
  @UseGuards(AuthenticationGuard)
  @ApiOperation({
    summary: 'List a pet weight history',
    description:
      'An active owner or collaborator may read weight history for an active or archived pet. Results are ordered by measured date, newest first.',
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
    description: 'Weight history page',
    schema: petWeightHistoryResponseSchema,
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
  ): Promise<PetWeightHistory> {
    const parsedPetId = weightRecordPetIdSchema.safeParse(petId);
    if (!parsedPetId.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Pet id is invalid',
      });
    }
    const parsedQuery = listPetWeightHistorySchema.safeParse(query);
    if (!parsedQuery.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request query is invalid',
      });
    }
    const request: ListPetWeightHistoryRequest = parsedQuery.data;
    const limit: number =
      request.limit === undefined ? 20 : Number(request.limit);
    if (limit > 100) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request query is invalid',
      });
    }

    try {
      return await this.listPetWeightHistory.execute({
        petId: parsedPetId.data,
        authenticatedAccountId,
        limit,
        cursor: request.cursor ?? null,
      });
    } catch (error: unknown) {
      if (error instanceof InvalidWeightHistoryCursorError) {
        throw new BadRequestException({
          code: 'INVALID_REQUEST',
          message: 'Cursor is invalid',
        });
      }
      if (error instanceof WeightHistoryPetNotFoundError) {
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
