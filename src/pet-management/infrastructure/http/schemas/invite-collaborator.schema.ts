import { z } from 'zod';

export interface InviteCollaboratorRequest {
  email: string;
}

export const inviteCollaboratorSchema: z.ZodType<InviteCollaboratorRequest> = z
  .object({ email: z.string() })
  .strict();
