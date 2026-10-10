import { z } from 'zod';

export const resolvePetMedicalConditionSchema = z
    .object({ resolvedDate: z.string().nullable() })
    .strict();
