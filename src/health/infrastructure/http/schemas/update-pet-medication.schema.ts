import { z } from 'zod';
import { medicationPetIdSchema } from './record-pet-medication.schema';

export const medicationIdSchema = medicationPetIdSchema;
export const updatePetMedicationQuerySchema = z.object({}).strict();
export const updatePetMedicationSchema = z
    .object({
        name: z.string().optional(),
        dosage: z.string().nullable().optional(),
        frequency: z.string().nullable().optional(),
        startDate: z.string().nullable().optional(),
        plannedEndDate: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        endedDate: z.string().nullable().optional(),
        discontinuationReason: z.string().nullable().optional(),
    })
    .strict()
    .refine((value): boolean => Object.values(value).some((field): boolean => field !== undefined));
export type UpdatePetMedicationRequest = z.infer<typeof updatePetMedicationSchema>;
