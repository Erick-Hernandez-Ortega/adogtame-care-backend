import { z } from 'zod';

const nonNilUuidSchema = z
    .uuid()
    .refine((value: string): boolean => value !== '00000000-0000-0000-0000-000000000000');

export const removePetMemberPetIdSchema = nonNilUuidSchema;
export const removePetMemberMembershipIdSchema = nonNilUuidSchema;
export const removePetMemberQuerySchema = z.object({}).strict();
export const removePetMemberBodySchema = z.object({}).strict();
