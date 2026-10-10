import { z } from 'zod';

export const restorePetIdSchema = z
    .uuid()
    .refine((value: string): boolean => value !== '00000000-0000-0000-0000-000000000000');
export const restorePetQuerySchema = z.object({}).strict();
export const restorePetBodySchema = z.object({}).strict();
