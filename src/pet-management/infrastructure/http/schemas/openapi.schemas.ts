import type { SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';
import { inviteCollaboratorSchema } from './invite-collaborator.schema';
import { registerPetSchema } from './register-pet.schema';
import { updatePetProfileSchema } from './update-pet-profile.schema';

export const registerPetRequestSchema = z.toJSONSchema(registerPetSchema, {
  target: 'openapi-3.0',
}) as SchemaObject;

export const updatePetProfileRequestSchema: SchemaObject = {
  ...(z.toJSONSchema(updatePetProfileSchema, {
    target: 'openapi-3.0',
  }) as SchemaObject),
  minProperties: 1,
};

export const inviteCollaboratorRequestSchema = z.toJSONSchema(
  inviteCollaboratorSchema,
  { target: 'openapi-3.0' },
) as SchemaObject;

const breedSchema: SchemaObject = {
  type: 'object',
  required: ['name', 'kind'],
  properties: {
    name: { type: 'string', example: 'Mixed breed' },
    kind: { type: 'string', enum: ['KNOWN', 'CUSTOM'] },
  },
};

const birthInformationSchema: SchemaObject = {
  type: 'object',
  required: ['date', 'accuracy'],
  properties: {
    date: { type: 'string', format: 'date', example: '2022-05-15' },
    accuracy: { type: 'string', enum: ['EXACT', 'APPROXIMATE'] },
  },
};

const petSummaryProperties: NonNullable<SchemaObject['properties']> = {
  id: { type: 'string', format: 'uuid' },
  name: { type: 'string', example: 'Luna' },
  species: { type: 'string', enum: ['DOG', 'CAT'] },
  breed: breedSchema,
  sex: { type: 'string', enum: ['MALE', 'FEMALE', 'UNKNOWN'] },
};

export const petSummaryResponseSchema: SchemaObject = {
  type: 'object',
  required: ['id', 'name', 'species', 'breed', 'sex', 'role', 'status'],
  properties: {
    ...petSummaryProperties,
    status: { type: 'string', enum: ['ACTIVE', 'ARCHIVED'] },
    role: { type: 'string', enum: ['OWNER', 'COLLABORATOR'] },
  },
  example: {
    id: '42b30488-fd7c-4c5d-b9cc-8c7aa5d171dd',
    name: 'Luna',
    species: 'DOG',
    breed: { name: 'Mixed breed', kind: 'CUSTOM' },
    sex: 'FEMALE',
    role: 'OWNER',
    status: 'ACTIVE',
  },
};

const petProfileProperties: NonNullable<SchemaObject['properties']> = {
  ...petSummaryProperties,
  birthInformation: birthInformationSchema,
  color: { type: 'string', nullable: true, example: 'Brown' },
  distinctiveMarks: { type: 'string', nullable: true, example: null },
  microchip: { type: 'string', nullable: true, example: null },
  status: { type: 'string', enum: ['ACTIVE', 'ARCHIVED'] },
};

const petProfileRequired: string[] = [
  'id',
  'name',
  'species',
  'breed',
  'sex',
  'birthInformation',
  'color',
  'distinctiveMarks',
  'microchip',
  'status',
];

export const petDetailResponseSchema: SchemaObject = {
  type: 'object',
  required: [...petProfileRequired, 'role'],
  properties: {
    ...petProfileProperties,
    role: { type: 'string', enum: ['OWNER', 'COLLABORATOR'] },
  },
  example: {
    ...(petSummaryResponseSchema.example as object),
    birthInformation: { date: '2022-05-15', accuracy: 'APPROXIMATE' },
    color: 'Brown',
    distinctiveMarks: null,
    microchip: null,
    status: 'ACTIVE',
  },
};

export const registeredPetResponseSchema: SchemaObject = {
  type: 'object',
  required: [...petProfileRequired, 'memberships'],
  properties: {
    ...petProfileProperties,
    memberships: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'accountId', 'role'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          accountId: { type: 'string', format: 'uuid' },
          role: { type: 'string', enum: ['OWNER', 'COLLABORATOR'] },
        },
      },
    },
  },
  example: {
    id: '42b30488-fd7c-4c5d-b9cc-8c7aa5d171dd',
    name: 'Luna',
    species: 'DOG',
    breed: { name: 'Mixed breed', kind: 'CUSTOM' },
    sex: 'FEMALE',
    birthInformation: { date: '2022-05-15', accuracy: 'APPROXIMATE' },
    color: 'Brown',
    distinctiveMarks: null,
    microchip: null,
    status: 'ACTIVE',
    memberships: [
      {
        id: '6fe44a29-206e-4875-9f3e-72026868135e',
        accountId: '9b4a221a-e6ad-41ab-b1b2-21230b8b65a4',
        role: 'OWNER',
      },
    ],
  },
};

export const createdInvitationResponseSchema: SchemaObject = {
  type: 'object',
  required: ['id', 'petId', 'email', 'status', 'createdAt', 'expiresAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    petId: { type: 'string', format: 'uuid' },
    email: { type: 'string', format: 'email' },
    status: { type: 'string', enum: ['PENDING'] },
    createdAt: { type: 'string', format: 'date-time' },
    expiresAt: { type: 'string', format: 'date-time' },
  },
  example: {
    id: '6fe44a29-206e-4875-9f3e-72026868135e',
    petId: '42b30488-fd7c-4c5d-b9cc-8c7aa5d171dd',
    email: 'friend@example.com',
    status: 'PENDING',
    createdAt: '2026-09-26T12:00:00.000Z',
    expiresAt: '2026-10-03T12:00:00.000Z',
  },
};

export const acceptedInvitationResponseSchema: SchemaObject = {
  type: 'object',
  required: ['id', 'petId', 'status'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    petId: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['ACCEPTED'] },
  },
  example: {
    id: '6fe44a29-206e-4875-9f3e-72026868135e',
    petId: '42b30488-fd7c-4c5d-b9cc-8c7aa5d171dd',
    status: 'ACCEPTED',
  },
};

export const rejectedInvitationResponseSchema: SchemaObject = {
  type: 'object',
  required: ['id', 'petId', 'status'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    petId: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['REJECTED'] },
  },
  example: {
    id: '6fe44a29-206e-4875-9f3e-72026868135e',
    petId: '42b30488-fd7c-4c5d-b9cc-8c7aa5d171dd',
    status: 'REJECTED',
  },
};

export const cancelledInvitationResponseSchema: SchemaObject = {
  type: 'object',
  required: ['id', 'petId', 'status'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    petId: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['CANCELLED'] },
  },
  example: {
    id: '6fe44a29-206e-4875-9f3e-72026868135e',
    petId: '42b30488-fd7c-4c5d-b9cc-8c7aa5d171dd',
    status: 'CANCELLED',
  },
};

export const petMembersResponseSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['members'],
  properties: {
    members: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['membershipId', 'accountId', 'email', 'role'],
        properties: {
          membershipId: { type: 'string', format: 'uuid' },
          accountId: { type: 'string', format: 'uuid' },
          email: {
            type: 'string',
            format: 'email',
            example: 'owner@example.com',
          },
          role: { type: 'string', enum: ['OWNER', 'COLLABORATOR'] },
        },
      },
    },
  },
};
