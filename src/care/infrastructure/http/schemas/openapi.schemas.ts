import type { SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';
import { createCareRoutineSchema } from './create-care-routine.schema';
import { RoutineType } from '../../../domain/routine-type/routine-type';
import { FrequencyPeriod, Weekday } from '../../../domain/routine-frequency/routine-frequency';

const frequencyProperties: Record<string, SchemaObject> = {
    period: { type: 'string', enum: Object.values(FrequencyPeriod) },
    timesPerPeriod: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    suggestedTimes: {
        type: 'array',
        maxItems: 24,
        uniqueItems: true,
        nullable: true,
        items: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
        description:
            'Local wall-clock HH:mm suggestions. Omission/null becomes an empty array. Order is preserved; duplicates are rejected.',
    },
    weekdays: {
        type: 'array',
        maxItems: 7,
        uniqueItems: true,
        nullable: true,
        items: { type: 'string', enum: Object.values(Weekday) },
        description:
            'Optional WEEKLY suggestions. DAILY accepts only omission, null or an empty array. No count relationship is imposed.',
    },
};

export const createCareRoutineRequestSchema: SchemaObject = {
    ...(z.toJSONSchema(createCareRoutineSchema, { target: 'openapi-3.0' }) as SchemaObject),
    properties: {
        type: { type: 'string', enum: Object.values(RoutineType) },
        title: {
            type: 'string',
            minLength: 1,
            maxLength: 255,
            description: 'Trimmed, case-preserving text. Limits count Unicode code points.',
        },
        instructions: {
            type: 'string',
            nullable: true,
            minLength: 1,
            maxLength: 2000,
            description:
                'Omit or send null for absence; supplied text must be nonempty after trimming. Limits count Unicode code points.',
        },
        frequency: {
            type: 'object',
            additionalProperties: false,
            required: ['period', 'timesPerPeriod'],
            properties: frequencyProperties,
        },
        timezone: {
            type: 'string',
            description:
                "Creator's IANA timezone, supplied explicitly; canonicalized using Intl. No machine or account default.",
        },
    },
    example: {
        type: 'FEEDING',
        title: 'Breakfast',
        instructions: 'Give one portion.',
        frequency: { period: 'DAILY', timesPerPeriod: 1, suggestedTimes: ['08:00'] },
        timezone: 'America/Mexico_City',
    },
};

export const createdCareRoutineResponseSchema: SchemaObject = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'petId',
        'type',
        'title',
        'instructions',
        'frequency',
        'timezone',
        'recordedByAccountId',
    ],
    properties: {
        id: { type: 'string', format: 'uuid' },
        petId: { type: 'string', format: 'uuid' },
        ...createCareRoutineRequestSchema.properties,
        frequency: {
            type: 'object',
            additionalProperties: false,
            required: ['period', 'timesPerPeriod', 'suggestedTimes', 'weekdays'],
            properties: {
                ...frequencyProperties,
                suggestedTimes: { ...frequencyProperties.suggestedTimes, nullable: false },
                weekdays: { ...frequencyProperties.weekdays, nullable: false },
            },
        },
        recordedByAccountId: {
            type: 'string',
            format: 'uuid',
            description: 'Authenticated recording account.',
        },
    },
};

const routineListProperties = Object.fromEntries(
    Object.entries(createdCareRoutineResponseSchema.properties ?? {}).filter(
        ([name]): boolean => name !== 'petId',
    ),
);

export const careRoutinesResponseSchema: SchemaObject = {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'nextCursor'],
    properties: {
        nextCursor: { type: 'string', nullable: true },
        items: {
            type: 'array',
            maxItems: 100,
            items: {
                type: 'object',
                additionalProperties: false,
                required: Object.keys(routineListProperties),
                properties: routineListProperties,
            },
        },
    },
};

export const updateCareRoutineRequestSchema: SchemaObject = {
    ...createCareRoutineRequestSchema,
    required: [],
    minProperties: 1,
    description:
        'Partial update. Omitted fields are preserved; null clears instructions. A supplied frequency replaces the complete frequency, using the creation shape. Timezone changes preserve local wall-clock suggestions.',
    example: { title: 'Evening meal', instructions: null, timezone: 'UTC' },
};

export const completeCareActivityRequestSchema: SchemaObject = {
    type: 'object',
    additionalProperties: false,
    required: ['completedAt', 'timezone'],
    properties: {
        completedAt: {
            type: 'string',
            format: 'date-time',
            pattern: '^\\d{4}-\\d{2}-\\d{2}T([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,3})?Z$',
            description:
                'Valid UTC instant ending in Z, with optional 1–3 fractional digits. Must be at or before the current instant. Returned with millisecond precision.',
        },
        timezone: {
            type: 'string',
            description:
                "Recorder's explicit IANA timezone; canonicalized using Intl. Independent of the routine timezone.",
        },
        notes: {
            type: 'string',
            nullable: true,
            minLength: 1,
            maxLength: 2000,
            description:
                'Optional trimmed notes, bounded by Unicode code points. Omission/null becomes null.',
        },
    },
    example: {
        completedAt: '2026-10-10T14:00:00.000Z',
        timezone: 'America/Mexico_City',
        notes: 'Finished breakfast.',
    },
};

export const completedCareActivityResponseSchema: SchemaObject = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'petId', 'routineId', 'completedAt', 'completedBy', 'timezone', 'notes'],
    properties: {
        id: { type: 'string', format: 'uuid' },
        petId: { type: 'string', format: 'uuid' },
        routineId: { type: 'string', format: 'uuid' },
        ...completeCareActivityRequestSchema.properties,
        completedBy: {
            type: 'string',
            format: 'uuid',
            description: 'Authenticated account recording completion.',
        },
    },
};

const activityListProperties = Object.fromEntries(
    Object.entries(completedCareActivityResponseSchema.properties ?? {}).filter(
        ([name]): boolean => name !== 'petId',
    ),
);

export const careActivitiesResponseSchema: SchemaObject = {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'nextCursor'],
    properties: {
        nextCursor: { type: 'string', nullable: true },
        items: {
            type: 'array',
            maxItems: 100,
            items: {
                type: 'object',
                additionalProperties: false,
                required: [...Object.keys(activityListProperties), 'localDay'],
                properties: {
                    ...activityListProperties,
                    localDay: {
                        type: 'string',
                        format: 'date',
                        description: 'Completion day in this activity’s recorded IANA timezone.',
                    },
                },
            },
        },
    },
};
