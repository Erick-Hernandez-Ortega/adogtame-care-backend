import { z } from 'zod';

export const medicalConditionPetIdSchema = z
  .uuid()
  .refine(
    (value: string): boolean =>
      value !== '00000000-0000-0000-0000-000000000000',
  );
export const recordPetMedicalConditionSchema = z
  .object({
    name: z.string(),
    diagnosedDate: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .strict();
export const recordPetMedicalConditionQuerySchema = z.object({}).strict();
export type RecordPetMedicalConditionRequest = z.infer<
  typeof recordPetMedicalConditionSchema
>;
