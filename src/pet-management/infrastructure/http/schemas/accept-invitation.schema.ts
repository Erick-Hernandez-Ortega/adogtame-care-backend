import { z } from 'zod';

export const invitationIdSchema = z.uuid();
export const emptyAcceptInvitationBodySchema = z.object({}).strict();
