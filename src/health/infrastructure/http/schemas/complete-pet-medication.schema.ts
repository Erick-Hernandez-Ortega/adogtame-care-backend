import { z } from 'zod';

export const completePetMedicationSchema = z.object({ endedDate: z.string().nullable() }).strict();
export const discontinuePetMedicationSchema = z
    .object({
        endedDate: z.string().nullable(),
        discontinuationReason: z.string().nullable().optional(),
    })
    .strict();
export const reopenPetMedicationSchema = z.object({}).strict();
