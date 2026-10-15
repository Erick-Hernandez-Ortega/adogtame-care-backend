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
        nullable: true,
        items: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
        description:
            'Local wall-clock HH:mm suggestions. Omission/null becomes an empty array. Order and duplicates are preserved.',
    },
    weekdays: {
        type: 'array',
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
