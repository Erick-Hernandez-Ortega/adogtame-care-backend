import { z } from 'zod';

export const rejectInvitationIdSchema = z.uuid();
export const emptyRejectInvitationBodySchema = z.object({}).strict();
