import { z } from 'zod';

export const completeCareActivitySchema = z
    .object({
        completedAt: z.string(),
        timezone: z.string(),
        notes: z.string().nullable().optional(),
    })
    .strict();
export const completeCareActivityQuerySchema = z.object({}).strict();
