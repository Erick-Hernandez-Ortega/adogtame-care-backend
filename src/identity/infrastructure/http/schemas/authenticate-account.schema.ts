import { z } from 'zod';
import type { AuthenticateAccountCommand } from '../../../application/authenticate-account/authenticate-account.types';

export const authenticateAccountSchema: z.ZodType<AuthenticateAccountCommand> =
  z
    .object({
      email: z.string(),
      password: z.string(),
    })
    .strict();
