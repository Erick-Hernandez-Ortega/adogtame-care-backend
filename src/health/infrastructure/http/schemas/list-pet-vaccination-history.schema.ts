import { z } from 'zod';

export const listPetVaccinationHistorySchema = z
  .object({
    limit: z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .optional(),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

export type ListPetVaccinationHistoryRequest = z.infer<
  typeof listPetVaccinationHistorySchema
>;
