import { z } from 'zod';
import { medicalConditionPetIdSchema } from './record-pet-medical-condition.schema';

export const medicalConditionIdSchema = medicalConditionPetIdSchema;
export const updatePetMedicalConditionSchema = z
  .object({
    name: z.string().optional(),
    diagnosedDate: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .strict()
  .refine(
    (value): boolean =>
      value.name !== undefined ||
      value.diagnosedDate !== undefined ||
      value.notes !== undefined,
  );
