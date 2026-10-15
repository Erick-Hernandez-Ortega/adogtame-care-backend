import { z } from 'zod';

export const veterinaryVisitPetIdSchema = z
    .uuid()
    .refine((value: string): boolean => value !== '00000000-0000-0000-0000-000000000000');
export const recordPetVeterinaryVisitSchema = z
    .object({
        reason: z.string(),
        visitDate: z.string(),
        diagnosis: z.string().nullable().optional(),
        observations: z.string().nullable().optional(),
    })
    .strict();
export const recordPetVeterinaryVisitQuerySchema = z.object({}).strict();
export type RecordPetVeterinaryVisitRequest = z.infer<typeof recordPetVeterinaryVisitSchema>;
