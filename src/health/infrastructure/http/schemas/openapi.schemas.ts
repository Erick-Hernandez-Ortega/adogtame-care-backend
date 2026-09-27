import type { SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';
import { recordPetWeightSchema } from './record-pet-weight.schema';

export const recordPetWeightRequestSchema = z.toJSONSchema(
  recordPetWeightSchema,
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
