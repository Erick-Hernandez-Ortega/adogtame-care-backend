import type { SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';
import { authenticateAccountSchema } from './authenticate-account.schema';
import { registerAccountSchema } from './register-account.schema';

export const registerAccountRequestSchema = z.toJSONSchema(
  registerAccountSchema,
  { target: 'openapi-3.0' },
) as SchemaObject;

export const authenticateAccountRequestSchema = z.toJSONSchema(
  authenticateAccountSchema,
  { target: 'openapi-3.0' },
) as SchemaObject;

export const registeredAccountResponseSchema: SchemaObject = {
  type: 'object',
  required: ['id', 'email'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    email: { type: 'string', format: 'email' },
  },
  example: {
    id: '42b30488-fd7c-4c5d-b9cc-8c7aa5d171dd',
    email: 'alex@example.com',
  },
};

export const authenticatedAccountResponseSchema: SchemaObject = {
  type: 'object',
  required: ['accessToken'],
  properties: {
    accessToken: { type: 'string', description: 'JWT Bearer token' },
  },
  example: { accessToken: 'eyJhbGciOiJIUzI1NiJ9.example.signature' },
};
