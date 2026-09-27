import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
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
import { DeletePetWeightRecord } from '../../../application/delete-pet-weight-record/delete-pet-weight-record';
import {
  UpdatePetWeightRecord,
  WeightRecordNotFoundError,
} from '../../../application/update-pet-weight-record/update-pet-weight-record';
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
  updatePetWeightRecordSchema,
  deletePetWeightRecordSchema,
  weightRecordIdSchema,
  weightRecordPetIdSchema,
  type RecordPetWeightRequest,
  type UpdatePetWeightRecordRequest,
} from '../schemas/record-pet-weight.schema';
import {
  listPetWeightHistorySchema,
  type ListPetWeightHistoryRequest,
} from '../schemas/list-pet-weight-history.schema';
import {
  petWeightHistoryResponseSchema,
  recordedPetWeightResponseSchema,
  recordPetWeightRequestSchema,
  updatePetWeightRecordRequestSchema,
} from '../schemas/openapi.schemas';

@Controller('pets/:petId/health/weight-records')
@ApiTags('Health')
@ApiBearerAuth()
export class WeightRecordsController {
  constructor(
    private readonly recordPetWeight: RecordPetWeight,
    private readonly listPetWeightHistory: ListPetWeightHistory,
    private readonly updatePetWeightRecord: UpdatePetWeightRecord,
    private readonly deletePetWeightRecord: DeletePetWeightRecord,
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

  @Patch(':weightRecordId')
  @UseGuards(AuthenticationGuard)
  @ApiOperation({
    summary: 'Correct a pet weight record',
    description:
      'An active owner or collaborator may correct a record for an active pet.',
  })
  @ApiParam({ name: 'petId', schema: { type: 'string', format: 'uuid' } })
  @ApiParam({
    name: 'weightRecordId',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBody({ schema: updatePetWeightRecordRequestSchema })
  @ApiResponse({
    status: 200,
    description: 'Corrected weight record',
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
    description: 'Pet or weight record missing or inaccessible',
    schema: {
      oneOf: [
        errorSchema(['PET_NOT_FOUND'], 'Pet was not found'),
        errorSchema(['WEIGHT_RECORD_NOT_FOUND'], 'Weight record was not found'),
      ],
    },
  })
  async update(
    @CurrentAccountId() authenticatedAccountId: string,
    @Param('petId') petId: string,
    @Param('weightRecordId') weightRecordId: string,
    @Body() body: unknown,
  ): Promise<RecordedPetWeight> {
    const parsedPetId = weightRecordPetIdSchema.safeParse(petId);
    const parsedRecordId = weightRecordIdSchema.safeParse(weightRecordId);
    if (!parsedPetId.success || !parsedRecordId.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request path is invalid',
      });
    }
    const parsedBody = updatePetWeightRecordSchema.safeParse(body);
    if (!parsedBody.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request body is invalid',
      });
    }
    const request: UpdatePetWeightRecordRequest = parsedBody.data;
    try {
      return await this.updatePetWeightRecord.execute({
        petId: parsedPetId.data,
        weightRecordId: parsedRecordId.data,
        authenticatedAccountId,
        weightKg: request.weightKg,
        measuredDate: request.measuredDate,
      });
    } catch (error: unknown) {
      this.rethrowMutationError(error);
    }
  }

  @Delete(':weightRecordId')
  @UseGuards(AuthenticationGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a pet weight record',
    description:
      'An active owner or collaborator may delete a record for an active pet.',
  })
  @ApiParam({ name: 'petId', schema: { type: 'string', format: 'uuid' } })
  @ApiParam({
    name: 'weightRecordId',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiResponse({ status: 204, description: 'Weight record deleted' })
  @ApiResponse({
    status: 400,
    description: 'Invalid path or body',
    schema: errorSchema(['INVALID_REQUEST'], 'Request body is invalid'),
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid Bearer token',
    schema: errorSchema(['UNAUTHENTICATED'], 'Authentication is required'),
  })
  @ApiResponse({
    status: 404,
    description: 'Pet or weight record missing or inaccessible',
    schema: {
      oneOf: [
        errorSchema(['PET_NOT_FOUND'], 'Pet was not found'),
        errorSchema(['WEIGHT_RECORD_NOT_FOUND'], 'Weight record was not found'),
      ],
    },
  })
  async delete(
    @CurrentAccountId() authenticatedAccountId: string,
    @Param('petId') petId: string,
    @Param('weightRecordId') weightRecordId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const parsedPetId = weightRecordPetIdSchema.safeParse(petId);
    const parsedRecordId = weightRecordIdSchema.safeParse(weightRecordId);
    if (!parsedPetId.success || !parsedRecordId.success) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request path is invalid',
      });
    }
    if (
      body !== undefined &&
      !deletePetWeightRecordSchema.safeParse(body).success
    ) {
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request body is invalid',
      });
    }
    try {
      await this.deletePetWeightRecord.execute({
        petId: parsedPetId.data,
        weightRecordId: parsedRecordId.data,
        authenticatedAccountId,
      });
    } catch (error: unknown) {
      this.rethrowMutationError(error);
    }
  }

  private rethrowMutationError(error: unknown): never {
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
    if (error instanceof WeightRecordNotFoundError) {
      throw new NotFoundException({
        code: 'WEIGHT_RECORD_NOT_FOUND',
        message: error.message,
      });
    }
    throw error;
  }
}
