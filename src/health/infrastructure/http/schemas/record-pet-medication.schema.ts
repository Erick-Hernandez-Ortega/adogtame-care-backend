import { z } from 'zod';

export const medicationPetIdSchema = z
    .uuid()
    .refine((value: string): boolean => value !== '00000000-0000-0000-0000-000000000000');
export const recordPetMedicationSchema = z
    .object({
        name: z.string(),
        dosage: z.string().nullable().optional(),
        frequency: z.string().nullable().optional(),
        startDate: z.string().nullable().optional(),
        plannedEndDate: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
    })
    .strict();
export const recordPetMedicationQuerySchema = z.object({}).strict();
export type RecordPetMedicationRequest = z.infer<typeof recordPetMedicationSchema>;
