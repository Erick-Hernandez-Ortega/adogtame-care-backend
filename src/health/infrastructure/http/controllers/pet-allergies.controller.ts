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
import { AuthenticationGuard } from '../../../../identity/infrastructure/http/authentication/authentication.guard';
import { CurrentAccountId } from '../../../../identity/infrastructure/http/decorators/current-account-id.decorator';
import { errorSchema } from '../../../../infrastructure/http/openapi-error.schema';
import {
  ListPetAllergies,
  PetNotFoundError as ListPetAllergiesPetNotFoundError,
  type PetAllergies,
} from '../../../application/list-pet-allergies/list-pet-allergies';
import { listPetAllergiesQuerySchema } from '../schemas/list-pet-allergies.schema';
import {
  RecordPetAllergy,
  PetNotFoundError,
  InvalidAllergenError,
  InvalidAllergyCategoryError,
  InvalidAllergySeverityError,
  InvalidAllergyNotesError,
  type RecordedPetAllergy,
} from '../../../application/record-pet-allergy/record-pet-allergy';
import {
  allergyPetIdSchema,
  recordPetAllergySchema,
  type RecordPetAllergyRequest,
} from '../schemas/record-pet-allergy.schema';
import {
  recordPetAllergyRequestSchema,
  recordedPetAllergyResponseSchema,
  petAllergiesResponseSchema,
} from '../schemas/openapi.schemas';

@Controller('pets/:petId/health/allergies')
@ApiTags('Health')
@ApiBearerAuth()
export class PetAllergiesController {
  constructor(
    private readonly recordPetAllergy: RecordPetAllergy,
    private readonly listPetAllergies: ListPetAllergies,
  ) {}

  @Get()
  @UseGuards(AuthenticationGuard)
  @ApiOperation({
    summary: 'List known pet allergies',
    description:
      'Active owners and collaborators may read all registered allergies of active or archived pets. Results are ordered by technical creation timestamp and allergy ID descending, not by a clinical date. An accessible pet without allergies returns an empty items array. No query parameters are accepted.',
  })
  @ApiParam({
    name: 'petId',
    description: 'Non-nil pet UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiResponse({
    status: 200,
    description: 'All registered pet allergies',
    schema: petAllergiesResponseSchema,
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
  ): Promise<PetAllergies> {
    const parsedPetId = allergyPetIdSchema.safeParse(petId);
    if (!parsedPetId.success)
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Pet id is invalid',
      });
    if (!listPetAllergiesQuerySchema.safeParse(query).success)
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request query is invalid',
      });
    try {
      return await this.listPetAllergies.execute({
        petId: parsedPetId.data,
        authenticatedAccountId,
      });
    } catch (error: unknown) {
      if (error instanceof ListPetAllergiesPetNotFoundError)
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
    summary: 'Record a known pet allergy',
    description:
      'An active owner or collaborator may record a known allergy for an active pet. Duplicate entries are allowed. No clinical identification date is required; authorship records the authenticated account.',
  })
  @ApiParam({
    name: 'petId',
    description: 'Non-nil pet UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBody({ schema: recordPetAllergyRequestSchema })
  @ApiResponse({
    status: 201,
    description: 'Recorded pet allergy',
    schema: recordedPetAllergyResponseSchema,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request, allergen, category, severity, or notes',
    schema: {
      oneOf: [
        errorSchema(['INVALID_REQUEST'], 'Request body is invalid'),
        errorSchema(['INVALID_ALLERGEN'], 'Allergen cannot be empty'),
        errorSchema(
          ['INVALID_ALLERGY_CATEGORY'],
          'Allergy category must be FOOD, MEDICATION, ENVIRONMENTAL, or OTHER',
        ),
        errorSchema(
          ['INVALID_ALLERGY_SEVERITY'],
          'Allergy severity must be MILD, MODERATE, SEVERE, or UNKNOWN',
        ),
        errorSchema(['INVALID_ALLERGY_NOTES'], 'Allergy notes cannot be empty'),
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
  ): Promise<RecordedPetAllergy> {
    const parsedPetId = allergyPetIdSchema.safeParse(petId);
    if (!parsedPetId.success)
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Pet id is invalid',
      });
    const parsedBody = recordPetAllergySchema.safeParse(body);
    if (!parsedBody.success)
      throw new BadRequestException({
        code: 'INVALID_REQUEST',
        message: 'Request body is invalid',
      });
    const request: RecordPetAllergyRequest = parsedBody.data;
    try {
      return await this.recordPetAllergy.execute({
        ...request,
        petId: parsedPetId.data,
        authenticatedAccountId,
      });
    } catch (error: unknown) {
      if (error instanceof InvalidAllergenError)
        throw new BadRequestException({
          code: 'INVALID_ALLERGEN',
          message: error.message,
        });
      if (error instanceof InvalidAllergyCategoryError)
        throw new BadRequestException({
          code: 'INVALID_ALLERGY_CATEGORY',
          message: error.message,
        });
      if (error instanceof InvalidAllergySeverityError)
        throw new BadRequestException({
          code: 'INVALID_ALLERGY_SEVERITY',
          message: error.message,
        });
      if (error instanceof InvalidAllergyNotesError)
        throw new BadRequestException({
          code: 'INVALID_ALLERGY_NOTES',
          message: error.message,
        });
      if (error instanceof PetNotFoundError)
        throw new NotFoundException({
          code: 'PET_NOT_FOUND',
          message: error.message,
        });
      throw error;
    }
  }
}
