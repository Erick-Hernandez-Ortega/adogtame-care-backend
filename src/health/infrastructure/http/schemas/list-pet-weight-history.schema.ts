import { z } from 'zod';

export const listPetWeightHistorySchema = z
    .object({
        limit: z
            .string()
            .regex(/^[1-9][0-9]*$/)
            .optional(),
        cursor: z.string().min(1).max(512).optional(),
    })
    .strict();

export type ListPetWeightHistoryRequest = z.infer<typeof listPetWeightHistorySchema>;
