import { z } from 'zod';
import { allergyPetIdSchema } from './record-pet-allergy.schema';

export const allergyIdSchema = allergyPetIdSchema;
export const updatePetAllergySchema = z
  .object({
    allergen: z.string().optional(),
    category: z.string().optional(),
    severity: z.string().optional(),
    notes: z.string().nullable().optional(),
  })
  .strict()
  .refine(
    (value): boolean =>
      value.allergen !== undefined ||
      value.category !== undefined ||
      value.severity !== undefined ||
      value.notes !== undefined,
  );
export type UpdatePetAllergyRequest = z.infer<typeof updatePetAllergySchema>;
