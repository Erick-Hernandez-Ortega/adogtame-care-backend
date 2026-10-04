import type { SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';
import { recordPetAllergySchema } from './record-pet-allergy.schema';
import {
  AllergyCategory,
  AllergySeverity,
} from '../../../domain/pet-allergy/pet-allergy';
import {
  recordPetWeightSchema,
  updatePetWeightRecordSchema,
} from './record-pet-weight.schema';
import {
  recordVaccinationSchema,
  updateVaccinationRecordSchema,
} from './record-vaccination.schema';

export const recordVaccinationRequestSchema: SchemaObject = {
  ...(z.toJSONSchema(recordVaccinationSchema, {
    target: 'openapi-3.0',
  }) as SchemaObject),
  properties: {
    vaccineName: { type: 'string', maxLength: 255 },
    appliedDate: { type: 'string', format: 'date' },
    nextDueDate: { type: 'string', format: 'date', nullable: true },
  },
};

export const updateVaccinationRecordRequestSchema: SchemaObject = {
  ...(z.toJSONSchema(updateVaccinationRecordSchema, {
    target: 'openapi-3.0',
  }) as SchemaObject),
  minProperties: 1,
  properties: {
    vaccineName: { type: 'string', maxLength: 255 },
    appliedDate: { type: 'string', format: 'date' },
    nextDueDate: { type: 'string', format: 'date', nullable: true },
  },
};

export const recordedVaccinationResponseSchema: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'petId',
    'vaccineName',
    'appliedDate',
    'nextDueDate',
    'recordedByAccountId',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    petId: { type: 'string', format: 'uuid' },
    vaccineName: { type: 'string', maxLength: 255, example: 'Rabies' },
    appliedDate: { type: 'string', format: 'date', example: '2026-09-20' },
    nextDueDate: {
      type: 'string',
      format: 'date',
      nullable: true,
      example: '2027-09-20',
    },
    recordedByAccountId: { type: 'string', format: 'uuid' },
  },
  example: {
    id: '6fe44a29-206e-4875-9f3e-72026868135e',
    petId: '42b30488-fd7c-4c5d-b9cc-8c7aa5d171dd',
    vaccineName: 'Rabies',
    appliedDate: '2026-09-20',
    nextDueDate: '2027-09-20',
    recordedByAccountId: '9b4a221a-e6ad-41ab-b1b2-21230b8b65a4',
  },
};

export const petVaccinationHistoryResponseSchema: SchemaObject = {
  type: 'object',
  required: ['items', 'nextCursor'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'id',
          'vaccineName',
          'appliedDate',
          'nextDueDate',
          'recordedByAccountId',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          vaccineName: { type: 'string', example: 'Rabies' },
          appliedDate: { type: 'string', format: 'date' },
          nextDueDate: { type: 'string', format: 'date', nullable: true },
          recordedByAccountId: { type: 'string', format: 'uuid' },
        },
      },
    },
    nextCursor: { type: 'string', nullable: true },
  },
};

export const recordPetWeightRequestSchema = z.toJSONSchema(
  recordPetWeightSchema,
  { target: 'openapi-3.0' },
) as SchemaObject;

export const updatePetWeightRecordRequestSchema = z.toJSONSchema(
  updatePetWeightRecordSchema,
  { target: 'openapi-3.0' },
) as SchemaObject;

export const recordedPetWeightResponseSchema: SchemaObject = {
  type: 'object',
  required: ['id', 'petId', 'weightKg', 'measuredDate', 'recordedByAccountId'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    petId: { type: 'string', format: 'uuid' },
    weightKg: { type: 'string', example: '12.3456' },
    measuredDate: { type: 'string', format: 'date', example: '2026-09-26' },
    recordedByAccountId: { type: 'string', format: 'uuid' },
  },
  example: {
    id: '6fe44a29-206e-4875-9f3e-72026868135e',
    petId: '42b30488-fd7c-4c5d-b9cc-8c7aa5d171dd',
    weightKg: '12.3456',
    measuredDate: '2026-09-26',
    recordedByAccountId: '9b4a221a-e6ad-41ab-b1b2-21230b8b65a4',
  },
};

export const petWeightHistoryResponseSchema: SchemaObject = {
  type: 'object',
  required: ['items', 'nextCursor'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'weightKg', 'measuredDate', 'recordedByAccountId'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          weightKg: { type: 'string', example: '12.34' },
          measuredDate: { type: 'string', format: 'date' },
          recordedByAccountId: { type: 'string', format: 'uuid' },
        },
      },
    },
    nextCursor: { type: 'string', nullable: true },
  },
};

export const recordPetAllergyRequestSchema: SchemaObject = {
  ...(z.toJSONSchema(recordPetAllergySchema, {
    target: 'openapi-3.0',
  }) as SchemaObject),
  properties: {
    allergen: {
      type: 'string',
      minLength: 1,
      maxLength: 255,
      description: 'Trimmed, nonempty allergen; casing is preserved.',
    },
    category: { type: 'string', enum: Object.values(AllergyCategory) },
    severity: {
      type: 'string',
      enum: Object.values(AllergySeverity),
      description:
        'Known or reported severity, not a formal diagnosis. Use UNKNOWN when severity is not known.',
    },
    notes: {
      type: 'string',
      nullable: true,
      minLength: 1,
      maxLength: 2000,
      description:
        'Omit or send null when absent. Present text must remain nonempty after trimming.',
    },
  },
  example: {
    allergen: 'Penicillin',
    category: 'MEDICATION',
    severity: 'SEVERE',
    notes: 'Previous reaction reported by veterinarian.',
  },
};
export const recordedPetAllergyResponseSchema: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'petId',
    'allergen',
    'category',
    'severity',
    'notes',
    'recordedByAccountId',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    petId: { type: 'string', format: 'uuid' },
    allergen: { type: 'string', minLength: 1, maxLength: 255 },
    category: { type: 'string', enum: Object.values(AllergyCategory) },
    severity: { type: 'string', enum: Object.values(AllergySeverity) },
    notes: { type: 'string', nullable: true, minLength: 1, maxLength: 2000 },
    recordedByAccountId: { type: 'string', format: 'uuid' },
  },
};
