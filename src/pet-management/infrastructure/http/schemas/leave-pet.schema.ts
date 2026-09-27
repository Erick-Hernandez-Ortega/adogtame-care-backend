import { z } from 'zod';

export const leavePetIdSchema = z.uuid();
export const emptyLeavePetBodySchema = z.object({}).strict();
