import { z } from 'zod';
import { petIdSchema } from './get-pet-detail.schema';

export const listPetMembersIdSchema = petIdSchema.refine(
  (value) => value !== '00000000-0000-0000-0000-000000000000',
);
export const listPetMembersQuerySchema = z.object({}).strict();
