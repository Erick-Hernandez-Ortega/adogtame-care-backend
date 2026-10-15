import { careRoutinePetIdSchema, createCareRoutineSchema } from './create-care-routine.schema';

export const careRoutineIdSchema = careRoutinePetIdSchema;
export const updateCareRoutineSchema = createCareRoutineSchema
    .partial()
    .refine((value): boolean => Object.values(value).some((field): boolean => field !== undefined));
