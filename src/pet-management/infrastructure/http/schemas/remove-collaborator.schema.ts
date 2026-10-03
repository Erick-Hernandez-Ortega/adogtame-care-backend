import { z } from 'zod';

const nonNilUuidSchema = z
  .uuid()
  .refine(
    (value: string): boolean =>
      value !== '00000000-0000-0000-0000-000000000000',
  );
export const removeCollaboratorPetIdSchema = nonNilUuidSchema;
export const removeCollaboratorMembershipIdSchema = nonNilUuidSchema;
export const removeCollaboratorQuerySchema = z.object({}).strict();
export const removeCollaboratorBodySchema = z.object({}).strict();
