import { z } from 'zod';

export const archivePetIdSchema = z
  .uuid()
  .refine(
    (value: string): boolean =>
      value !== '00000000-0000-0000-0000-000000000000',
  );
export const archivePetQuerySchema = z.object({}).strict();
export const archivePetBodySchema = z.object({}).strict();
