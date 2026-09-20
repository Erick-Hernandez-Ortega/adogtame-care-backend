import { z } from 'zod';
import type { RegisterPetCommand } from '../../../application/register-pet/register-pet.types';

export const registerPetSchema: z.ZodType<RegisterPetCommand> = z
  .object({
    name: z.string(),
    species: z.enum(['DOG', 'CAT']),
    breed: z
      .object({
        name: z.string(),
        kind: z.enum(['KNOWN', 'CUSTOM']),
      })
      .strict(),
    sex: z.enum(['MALE', 'FEMALE', 'UNKNOWN']),
    birthInformation: z
      .object({
        date: z.string(),
        accuracy: z.enum(['EXACT', 'APPROXIMATE']),
      })
      .strict(),
    ownerId: z.string(),
    color: z.string().optional(),
    distinctiveMarks: z.string().optional(),
    microchip: z.string().optional(),
  })
  .strict();
