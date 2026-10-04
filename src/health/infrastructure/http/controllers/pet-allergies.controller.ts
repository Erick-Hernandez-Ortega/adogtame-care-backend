import {
  BadRequestException,
  Body,
  Controller,
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
} from '../schemas/openapi.schemas';

@Controller('pets/:petId/health/allergies')
@ApiTags('Health')
@ApiBearerAuth()
export class PetAllergiesController {
  constructor(private readonly recordPetAllergy: RecordPetAllergy) {}

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
