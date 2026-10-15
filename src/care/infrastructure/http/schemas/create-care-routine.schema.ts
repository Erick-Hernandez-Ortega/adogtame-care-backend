import { z } from 'zod';

export const careRoutinePetIdSchema = z
    .uuid()
    .refine((value: string): boolean => value !== '00000000-0000-0000-0000-000000000000');
export const createCareRoutineSchema = z
    .object({
        type: z.string(),
        title: z.string(),
        instructions: z.string().nullable().optional(),
        frequency: z
            .object({
                period: z.string(),
                timesPerPeriod: z.number(),
                suggestedTimes: z.array(z.string()).nullable().optional(),
                weekdays: z.array(z.string()).nullable().optional(),
            })
            .strict(),
        timezone: z.string(),
    })
    .strict();
export const createCareRoutineQuerySchema = z.object({}).strict();
export type CreateCareRoutineRequest = z.infer<typeof createCareRoutineSchema>;
