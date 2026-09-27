import { z } from 'zod';

export const cancelInvitationIdSchema = z.uuid();
export const emptyCancelInvitationBodySchema = z.object({}).strict();
