import { z } from 'zod';

export const weightRecordPetIdSchema = z.uuid();
export const recordPetWeightSchema = z
  .object({
    weightKg: z.string(),
    measuredDate: z.string(),
  })
  .strict();

export type RecordPetWeightRequest = z.infer<typeof recordPetWeightSchema>;
