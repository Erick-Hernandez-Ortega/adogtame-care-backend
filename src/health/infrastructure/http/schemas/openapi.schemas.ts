import type { SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';
import { recordPetAllergySchema } from './record-pet-allergy.schema';
import { recordPetMedicalConditionSchema } from './record-pet-medical-condition.schema';
import { AllergyCategory, AllergySeverity } from '../../../domain/pet-allergy/pet-allergy';
import { recordPetWeightSchema, updatePetWeightRecordSchema } from './record-pet-weight.schema';
import {
    recordVaccinationSchema,
    updateVaccinationRecordSchema,
} from './record-vaccination.schema';

export const recordPetMedicalConditionRequestSchema: SchemaObject = {
    ...(z.toJSONSchema(recordPetMedicalConditionSchema, {
        target: 'openapi-3.0',
    }) as SchemaObject),
    properties: {
        name: {
            type: 'string',
            minLength: 1,
            maxLength: 255,
            description:
                'Trimmed, nonempty name; casing is preserved. Limits count Unicode code points.',
        },
        diagnosedDate: {
            type: 'string',
            format: 'date',
            nullable: true,
            description:
                'Exact known date of the reported diagnosis, YYYY-MM-DD, not later than today UTC. Omit or send null if unknown or only approximate.',
        },
        notes: {
            type: 'string',
            nullable: true,
            minLength: 1,
            maxLength: 2000,
            description:
                'Omit or send null when absent. Present text must remain nonempty after trimming. Limits count Unicode code points.',
        },
    },
    example: {
        name: 'Epilepsy',
        diagnosedDate: '2026-03-14',
        notes: 'Recurring seizures monitored by veterinarian.',
    },
};

export const recordedPetMedicalConditionResponseSchema: SchemaObject = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'petId',
        'name',
        'status',
        'diagnosedDate',
        'resolvedDate',
        'notes',
        'recordedByAccountId',
    ],
    properties: {
        id: { type: 'string', format: 'uuid' },
        petId: { type: 'string', format: 'uuid' },
        name: { type: 'string', minLength: 1, maxLength: 255, example: 'Epilepsy' },
        status: {
            type: 'string',
            enum: ['ACTIVE'],
            description: 'Record always creates a currently active condition.',
        },
        diagnosedDate: {
            type: 'string',
            format: 'date',
            nullable: true,
            example: '2026-03-14',
        },
        resolvedDate: { type: 'string', format: 'date', nullable: true },
        notes: { type: 'string', nullable: true, minLength: 1, maxLength: 2000 },
        recordedByAccountId: { type: 'string', format: 'uuid' },
    },
};

export const updatePetMedicalConditionRequestSchema: SchemaObject = {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
        ...recordPetMedicalConditionRequestSchema.properties,
        diagnosedDate: {
            type: 'string',
            format: 'date',
            nullable: true,
            description:
                'Exact known reported diagnosis date, no later than today UTC. Omission preserves the stored date; null clears it.',
        },
        notes: {
            type: 'string',
            nullable: true,
            minLength: 1,
            maxLength: 2000,
            description:
                'Omission preserves notes; null clears them. Present text must be nonempty after trimming; limits count Unicode code points.',
        },
    },
    description:
        'At least one field is required. Status, resolvedDate, identity, author and technical timestamps cannot be modified. Update does not Resolve or Reopen.',
    example: {
        name: 'Osteoarthritis',
        diagnosedDate: '2026-02-10',
        notes: 'Confirmed during veterinary examination.',
    },
};

export const updatedPetMedicalConditionResponseSchema: SchemaObject = {
    ...recordedPetMedicalConditionResponseSchema,
    properties: {
        ...recordedPetMedicalConditionResponseSchema.properties,
        status: {
            type: 'string',
            enum: ['ACTIVE', 'RESOLVED'],
            description: 'Original clinical status is preserved.',
        },
    },
};

export const petMedicalConditionsResponseSchema: SchemaObject = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
        items: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: [
                    'id',
                    'name',
                    'status',
                    'diagnosedDate',
                    'resolvedDate',
                    'notes',
                    'recordedByAccountId',
                ],
                properties: {
                    id: { type: 'string', format: 'uuid' },
                    name: { type: 'string', minLength: 1, maxLength: 255 },
                    status: { type: 'string', enum: ['ACTIVE', 'RESOLVED'] },
                    diagnosedDate: {
                        type: 'string',
                        format: 'date',
                        nullable: true,
                        description:
                            'Exact known date of the reported diagnosis; null when unknown or only approximate.',
                    },
                    resolvedDate: { type: 'string', format: 'date', nullable: true },
                    notes: {
                        type: 'string',
                        nullable: true,
                        minLength: 1,
                        maxLength: 2000,
                    },
                    recordedByAccountId: { type: 'string', format: 'uuid' },
                },
            },
        },
    },
};

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
    required: ['id', 'petId', 'vaccineName', 'appliedDate', 'nextDueDate', 'recordedByAccountId'],
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

export const recordPetWeightRequestSchema = z.toJSONSchema(recordPetWeightSchema, {
    target: 'openapi-3.0',
}) as SchemaObject;

export const updatePetWeightRecordRequestSchema = z.toJSONSchema(updatePetWeightRecordSchema, {
    target: 'openapi-3.0',
}) as SchemaObject;

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
    required: ['id', 'petId', 'allergen', 'category', 'severity', 'notes', 'recordedByAccountId'],
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

export const petAllergiesResponseSchema: SchemaObject = {
    type: 'object',
    required: ['items'],
    properties: {
        items: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'id',
                    'allergen',
                    'category',
                    'severity',
                    'notes',
                    'recordedByAccountId',
                ],
                properties: {
                    id: { type: 'string', format: 'uuid' },
                    allergen: { type: 'string', minLength: 1, maxLength: 255 },
                    category: { type: 'string', enum: Object.values(AllergyCategory) },
                    severity: { type: 'string', enum: Object.values(AllergySeverity) },
                    notes: {
                        type: 'string',
                        nullable: true,
                        minLength: 1,
                        maxLength: 2000,
                    },
                    recordedByAccountId: { type: 'string', format: 'uuid' },
                },
            },
        },
    },
};

export const updatePetAllergyRequestSchema: SchemaObject = {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
        ...recordPetAllergyRequestSchema.properties,
        notes: {
            type: 'string',
            nullable: true,
            minLength: 1,
            maxLength: 2000,
            description:
                'Omit to preserve current notes; send null to clear them. Text is trimmed and must remain nonempty.',
        },
    },
    example: { severity: 'SEVERE', notes: null },
};

export const resolvePetMedicalConditionRequestSchema: SchemaObject = {
    type: 'object',
    additionalProperties: false,
    required: ['resolvedDate'],
    properties: {
        resolvedDate: {
            type: 'string',
            format: 'date',
            nullable: true,
            description:
                'Required exact clinical resolution date, no later than today UTC, or null when unknown. No default. On RESOLVED retries the supplied value is ignored and the existing date is preserved.',
        },
    },
    example: { resolvedDate: '2026-09-15' },
};

export const resolvedPetMedicalConditionResponseSchema: SchemaObject = {
    ...updatedPetMedicalConditionResponseSchema,
    properties: {
        ...updatedPetMedicalConditionResponseSchema.properties,
        status: { type: 'string', enum: ['RESOLVED'] },
    },
};
