import { z } from 'zod';

const nonNilUuidSchema = z
  .uuid()
  .refine((value) => value !== '00000000-0000-0000-0000-000000000000');
export const weightRecordPetIdSchema = nonNilUuidSchema;
export const weightRecordIdSchema = nonNilUuidSchema;
export const recordPetWeightSchema = z
  .object({
    weightKg: z.string(),
    measuredDate: z.string(),
  })
  .strict();

export type RecordPetWeightRequest = z.infer<typeof recordPetWeightSchema>;

export const updatePetWeightRecordSchema = z
  .object({
    weightKg: z.string().optional(),
    measuredDate: z.string().optional(),
  })
  .strict()
  .refine(
    (value) => value.weightKg !== undefined || value.measuredDate !== undefined,
  );
export type UpdatePetWeightRecordRequest = z.infer<
  typeof updatePetWeightRecordSchema
>;

export const deletePetWeightRecordSchema = z.object({}).strict();
