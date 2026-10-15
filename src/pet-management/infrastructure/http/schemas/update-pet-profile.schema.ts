import { boundedString } from '../../../../infrastructure/http/bounded-string';
import { z } from 'zod';
import { petIdSchema } from './get-pet-detail.schema';

export const updatePetProfileIdSchema = petIdSchema.refine(
    (value) => value !== '00000000-0000-0000-0000-000000000000',
);

export const updatePetProfileSchema = z
    .object({
        name: boundedString(255).optional(),
        species: z.enum(['DOG', 'CAT']).optional(),
        breed: z
            .object({
                name: boundedString(255),
                kind: z.enum(['KNOWN', 'CUSTOM']),
            })
            .strict()
            .optional(),
        sex: z.enum(['MALE', 'FEMALE', 'UNKNOWN']).optional(),
        birthInformation: z
            .object({
                date: z.string(),
                accuracy: z.enum(['EXACT', 'APPROXIMATE']),
            })
            .strict()
            .optional(),
        color: boundedString(255).nullable().optional(),
        distinctiveMarks: boundedString(2000).nullable().optional(),
        microchip: boundedString(255).nullable().optional(),
    })
    .strict()
    .refine((value) => Object.values(value).some((field) => field !== undefined));

export type UpdatePetProfileRequest = z.infer<typeof updatePetProfileSchema>;
