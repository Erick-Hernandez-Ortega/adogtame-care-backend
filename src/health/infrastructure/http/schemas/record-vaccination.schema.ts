import { z } from 'zod';

export const vaccinationPetIdSchema = z
    .uuid()
    .refine((value) => value !== '00000000-0000-0000-0000-000000000000');
export const vaccinationRecordIdSchema = vaccinationPetIdSchema;

export const recordVaccinationSchema = z
    .object({
        vaccineName: z.string(),
        appliedDate: z.string(),
        nextDueDate: z.string().nullable().optional(),
    })
    .strict();

export type RecordVaccinationRequest = z.infer<typeof recordVaccinationSchema>;

export const updateVaccinationRecordSchema = z
    .object({
        vaccineName: z.string().optional(),
        appliedDate: z.string().optional(),
        nextDueDate: z.string().nullable().optional(),
    })
    .strict()
    .refine(
        (value) =>
            value.vaccineName !== undefined ||
            value.appliedDate !== undefined ||
            value.nextDueDate !== undefined,
    );
export type UpdateVaccinationRecordRequest = z.infer<typeof updateVaccinationRecordSchema>;

export const deleteVaccinationRecordSchema = z.object({}).strict();
