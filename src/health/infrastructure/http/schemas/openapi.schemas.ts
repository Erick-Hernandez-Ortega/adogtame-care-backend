import { recordPetVeterinaryVisitSchema } from './record-pet-veterinary-visit.schema';
import { recordPetMedicationSchema } from './record-pet-medication.schema';
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

export const reopenedPetMedicalConditionResponseSchema: SchemaObject = {
    ...updatedPetMedicalConditionResponseSchema,
    properties: {
        ...updatedPetMedicalConditionResponseSchema.properties,
        status: { type: 'string', enum: ['ACTIVE'] },
        resolvedDate: { type: 'string', format: 'date', nullable: true, enum: [null] },
    },
};

export const recordPetMedicationRequestSchema: SchemaObject = {
    ...(z.toJSONSchema(recordPetMedicationSchema, { target: 'openapi-3.0' }) as SchemaObject),
    properties: {
        name: {
            type: 'string',
            minLength: 1,
            maxLength: 255,
            description:
                'Required trimmed nonempty medication name. Casing is preserved; limits count Unicode code points. Commercial and generic names are accepted without a catalog.',
        },
        dosage: {
            type: 'string',
            nullable: true,
            minLength: 1,
            maxLength: 2000,
            description:
                'Indicated dosage as free text, without interpretation or calculation. Omit or send null when unknown. Present text must remain nonempty after trimming; limits count Unicode code points.',
        },
        frequency: {
            type: 'string',
            nullable: true,
            minLength: 1,
            maxLength: 2000,
            description:
                'Indicated frequency as free text; no schedules or dose administration are generated. Omit or send null when unknown. Present text must remain nonempty after trimming; limits count Unicode code points.',
        },
        startDate: {
            type: 'string',
            format: 'date',
            nullable: true,
            description:
                'Indicated or reported start, not proof that the first dose was administered. Valid civil YYYY-MM-DD date, 0001-01-01 through 9999-12-31, including future dates. Omit or send null when unknown.',
        },
        plannedEndDate: {
            type: 'string',
            format: 'date',
            nullable: true,
            description:
                'Exclusively the planned end, not confirmation of actual treatment completion. Valid civil YYYY-MM-DD date, 0001-01-01 through 9999-12-31, including future dates. Must be on or after startDate when both are known. Omit or send null when unknown.',
        },
        notes: {
            type: 'string',
            nullable: true,
            minLength: 1,
            maxLength: 2000,
            description:
                'Omit or send null when absent. Present text must remain nonempty after trimming; limits count Unicode code points.',
        },
    },
    example: {
        name: 'Amoxicillin',
        dosage: '250 mg',
        frequency: 'Every 12 hours',
        startDate: '2026-10-10',
        plannedEndDate: '2026-10-17',
        notes: 'Give with food',
    },
};

const medicationLifecycleProperties: Record<string, SchemaObject> = {
    status: {
        type: 'string',
        enum: ['OPEN', 'COMPLETED', 'DISCONTINUED'],
        description:
            'OPEN means no closure recorded. Closed states are reported facts, not clinical confirmation or evidence of administered doses.',
    },
    endedDate: {
        type: 'string',
        format: 'date',
        nullable: true,
        description:
            'Reported closure date, null when unknown. Never defaults to today. Newly supplied dates cannot be future. COMPLETED dates must be on or after a known indicated start; DISCONTINUED may precede it.',
    },
    discontinuationReason: {
        type: 'string',
        nullable: true,
        minLength: 1,
        maxLength: 2000,
        description:
            'Optional reported discontinuation explanation. Trimmed nonempty text, at most 2000 Unicode code points. Null outside DISCONTINUED.',
    },
};

export const completePetMedicationRequestSchema: SchemaObject = {
    type: 'object',
    additionalProperties: false,
    required: ['endedDate'],
    properties: { endedDate: medicationLifecycleProperties.endedDate },
};

export const discontinuePetMedicationRequestSchema: SchemaObject = {
    ...completePetMedicationRequestSchema,
    properties: {
        endedDate: medicationLifecycleProperties.endedDate,
        discontinuationReason: medicationLifecycleProperties.discontinuationReason,
    },
};

export const updatePetMedicationRequestSchema: SchemaObject = {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
        ...recordPetMedicationRequestSchema.properties,
        endedDate: {
            ...medicationLifecycleProperties.endedDate,
            description:
                'Correct only on a closed record; omission preserves, null clears. Invalid chronology or future dates are rejected. Does not change status.',
        },
        discontinuationReason: {
            ...medicationLifecycleProperties.discontinuationReason,
            description:
                'Correct only on DISCONTINUED; omission preserves, null clears. Does not change status.',
        },
        dosage: {
            ...recordPetMedicationRequestSchema.properties?.dosage,
            description:
                'Omission preserves dosage; null clears it. Present free text is trimmed, nonempty, and limited to 2000 Unicode code points. No pharmacological interpretation or calculations.',
        },
        frequency: {
            ...recordPetMedicationRequestSchema.properties?.frequency,
            description:
                'Omission preserves frequency; null clears it. Present free text is trimmed, nonempty, and limited to 2000 Unicode code points. No schedules or dose administration.',
        },
        startDate: {
            ...recordPetMedicationRequestSchema.properties?.startDate,
            description:
                'Omission preserves start date; null clears it. Valid civil YYYY-MM-DD date from 0001-01-01 through 9999-12-31, including future dates. The resulting interval must remain valid; this does not prove administration.',
        },
        plannedEndDate: {
            ...recordPetMedicationRequestSchema.properties?.plannedEndDate,
            description:
                'Omission preserves planned end date; null clears it. Valid civil YYYY-MM-DD date from 0001-01-01 through 9999-12-31, including future dates. Must be on or after the resulting startDate when both exist. This does not confirm completion.',
        },
        notes: {
            ...recordPetMedicationRequestSchema.properties?.notes,
            description:
                'Omission preserves notes; null clears them. Present text is trimmed, nonempty, and limited to 2000 Unicode code points.',
        },
    },
    description:
        'Strict partial correction of indication information and applicable closure details. Status cannot be patched. Supplying closure fields in an inapplicable state returns 409. Omission preserves the current value; explicit null clears an optional field. Name cannot be null. Text is trimmed and must remain nonempty; limits count Unicode code points. Both civil dates may be future. The resulting plannedEndDate must be on or after the resulting startDate when both exist, including dates preserved by omission. Equivalent normalized values are a no-op without a physical UPDATE or timestamp changes. This corrects recorded information, not a new prescription, dose administration, completion or discontinuation.',
    example: { dosage: '500 mg', plannedEndDate: null },
};

export const recordedPetMedicationResponseSchema: SchemaObject = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'petId',
        'name',
        'dosage',
        'frequency',
        'startDate',
        'plannedEndDate',
        'notes',
        'recordedByAccountId',
        'status',
        'endedDate',
        'discontinuationReason',
    ],
    properties: {
        ...medicationLifecycleProperties,
        id: {
            type: 'string',
            format: 'uuid',
            description: 'Independent UUID v4 medication record identity.',
        },
        petId: { type: 'string', format: 'uuid' },
        ...recordPetMedicationRequestSchema.properties,
        recordedByAccountId: {
            type: 'string',
            format: 'uuid',
            description:
                'Authenticated recording account; historical authorship does not grant access.',
        },
    },
};

export const listedPetMedicationResponseSchema: SchemaObject = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'name',
        'dosage',
        'frequency',
        'startDate',
        'plannedEndDate',
        'notes',
        'recordedByAccountId',
        'status',
        'endedDate',
        'discontinuationReason',
    ],
    properties: {
        ...medicationLifecycleProperties,
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string', description: 'Registered medication name.' },
        dosage: {
            type: 'string',
            nullable: true,
            description: 'Reported dosage as free text, or null when unknown; no calculations.',
        },
        frequency: {
            type: 'string',
            nullable: true,
            description: 'Reported frequency as free text, or null when unknown; no schedules.',
        },
        startDate: {
            type: 'string',
            format: 'date',
            nullable: true,
            description:
                'Reported civil YYYY-MM-DD start date, or null when unknown. May be future and does not prove administration.',
        },
        plannedEndDate: {
            type: 'string',
            format: 'date',
            nullable: true,
            description:
                'Planned civil YYYY-MM-DD end date, or null when unknown. May be future and does not confirm actual completion.',
        },
        notes: { type: 'string', nullable: true, description: 'Registered notes, or null.' },
        recordedByAccountId: {
            type: 'string',
            format: 'uuid',
            description: 'Historical recording account; authorship does not grant access.',
        },
    },
};

export const petMedicationsResponseSchema: SchemaObject = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
        items: { type: 'array', items: listedPetMedicationResponseSchema },
    },
};

export const recordPetVeterinaryVisitRequestSchema: SchemaObject = {
    ...(z.toJSONSchema(recordPetVeterinaryVisitSchema, { target: 'openapi-3.0' }) as SchemaObject),
    properties: {
        visitDate: {
            type: 'string',
            format: 'date',
            description:
                'Required exact calendar date YYYY-MM-DD, years 0001–9999, no later than today UTC.',
        },
        reason: {
            type: 'string',
            minLength: 1,
            maxLength: 255,
            description:
                'Required trimmed nonempty text, preserving casing. Limits count Unicode code points.',
        },
        diagnosis: {
            type: 'string',
            nullable: true,
            minLength: 1,
            maxLength: 2000,
            description:
                'Omit or send null when absent. Supplied text is trimmed and nonempty. Limits count Unicode code points.',
        },
        observations: {
            type: 'string',
            nullable: true,
            minLength: 1,
            maxLength: 5000,
            description:
                'Omit or send null when absent. Supplied text is trimmed and nonempty. Limits count Unicode code points.',
        },
    },
    example: {
        visitDate: '2026-03-14',
        reason: 'Annual checkup',
        diagnosis: null,
        observations: 'Routine examination completed.',
    },
};

export const recordedPetVeterinaryVisitResponseSchema: SchemaObject = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'petId',
        'visitDate',
        'reason',
        'diagnosis',
        'observations',
        'recordedByAccountId',
    ],
    properties: {
        id: { type: 'string', format: 'uuid' },
        petId: { type: 'string', format: 'uuid' },
        ...recordPetVeterinaryVisitRequestSchema.properties,
        recordedByAccountId: { type: 'string', format: 'uuid' },
    },
};
