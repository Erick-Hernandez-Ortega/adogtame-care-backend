import { z } from 'zod';

export const allergyPetIdSchema = z
    .uuid()
    .refine((value: string): boolean => value !== '00000000-0000-0000-0000-000000000000');
export const recordPetAllergySchema = z
    .object({
        allergen: z.string(),
        category: z.string(),
        severity: z.string(),
        notes: z.string().nullable().optional(),
    })
    .strict();
export type RecordPetAllergyRequest = z.infer<typeof recordPetAllergySchema>;
