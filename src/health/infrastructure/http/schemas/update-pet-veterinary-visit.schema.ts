import { z } from 'zod';
import { veterinaryVisitPetIdSchema } from './record-pet-veterinary-visit.schema';

export const veterinaryVisitIdSchema = veterinaryVisitPetIdSchema;
export const updatePetVeterinaryVisitSchema = z
    .object({
        reason: z.string().optional(),
        visitDate: z.string().optional(),
        diagnosis: z.string().nullable().optional(),
        observations: z.string().nullable().optional(),
    })
    .strict()
    .refine(
        (value): boolean =>
            value.reason !== undefined ||
            value.visitDate !== undefined ||
            value.diagnosis !== undefined ||
            value.observations !== undefined,
    );
