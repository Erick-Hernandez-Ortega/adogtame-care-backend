import { z } from 'zod';

export const leavePetIdSchema = z
    .uuid()
    .refine((value: string): boolean => value !== '00000000-0000-0000-0000-000000000000');
export const emptyLeavePetBodySchema = z.object({}).strict();

export const leavePetQuerySchema = z.object({}).strict();
