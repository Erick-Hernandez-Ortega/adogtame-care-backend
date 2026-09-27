import { z } from 'zod';

export const vaccinationPetIdSchema = z
  .uuid()
  .refine((value) => value !== '00000000-0000-0000-0000-000000000000');

export const recordVaccinationSchema = z
  .object({
    vaccineName: z.string(),
    appliedDate: z.string(),
    nextDueDate: z.string().nullable().optional(),
  })
  .strict();

export type RecordVaccinationRequest = z.infer<typeof recordVaccinationSchema>;
