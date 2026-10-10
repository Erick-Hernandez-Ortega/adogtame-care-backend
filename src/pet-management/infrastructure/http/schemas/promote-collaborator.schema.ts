import { z } from 'zod';

const nonNilUuidSchema = z
    .uuid()
    .refine((value: string): boolean => value !== '00000000-0000-0000-0000-000000000000');

export const promoteCollaboratorPetIdSchema = nonNilUuidSchema;
export const promoteCollaboratorMembershipIdSchema = nonNilUuidSchema;
export const promoteCollaboratorQuerySchema = z.object({}).strict();
export const promoteCollaboratorBodySchema = z.object({}).strict();
