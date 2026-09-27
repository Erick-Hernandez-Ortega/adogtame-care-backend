import type { SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';
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
