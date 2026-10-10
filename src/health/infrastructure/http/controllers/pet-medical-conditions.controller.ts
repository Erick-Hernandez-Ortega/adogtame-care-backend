import {
  BadRequestException,
  Body,
  Controller,
  Get,
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
  recordPetMedicalConditionRequestSchema,
  recordedPetMedicalConditionResponseSchema,
  petMedicalConditionsResponseSchema,
} from '../schemas/openapi.schemas';

@Controller('pets/:petId/health/medical-conditions')
@ApiTags('Health')
@ApiBearerAuth()
export class PetMedicalConditionsController {
  constructor(
    private readonly recordPetMedicalCondition: RecordPetMedicalCondition,
    private readonly listPetMedicalConditions: ListPetMedicalConditions,
  ) {}

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
    if (!parsedPetId.success)
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Pet id is invalid',
      });
    if (!listPetMedicalConditionsQuerySchema.safeParse(query).success)
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request query is invalid',
      });
    try {
      return await this.listPetMedicalConditions.execute({
        petId: parsedPetId.data,
        authenticatedAccountId,
      });
    } catch (error: unknown) {
      if (error instanceof ListPetMedicalConditionsPetNotFoundError)
        throw new NotFoundException({
          code: 'PET_NOT_FOUND',
          message: error.message,
        });
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
    if (!parsedPetId.success)
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Pet id is invalid',
      });
    const parsedBody = recordPetMedicalConditionSchema.safeParse(body);
    if (!parsedBody.success)
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request body is invalid',
      });
    if (!recordPetMedicalConditionQuerySchema.safeParse(query).success)
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request query is invalid',
      });
    try {
      return await this.recordPetMedicalCondition.execute({
        ...parsedBody.data,
        petId: parsedPetId.data,
        authenticatedAccountId,
      });
    } catch (error: unknown) {
      if (error instanceof PetNotFoundError)
        throw new NotFoundException({
          code: 'PET_NOT_FOUND',
          message: error.message,
        });
      if (error instanceof InvalidMedicalConditionNameError)
        throw new BadRequestException({
          code: 'INVALID_MEDICAL_CONDITION_NAME',
          message: error.message,
        });
      if (error instanceof InvalidMedicalConditionDiagnosedDateError)
        throw new BadRequestException({
          code: 'INVALID_MEDICAL_CONDITION_DIAGNOSED_DATE',
          message: error.message,
        });
      if (error instanceof InvalidMedicalConditionNotesError)
        throw new BadRequestException({
          code: 'INVALID_MEDICAL_CONDITION_NOTES',
          message: error.message,
        });
      throw error;
    }
  }
}
