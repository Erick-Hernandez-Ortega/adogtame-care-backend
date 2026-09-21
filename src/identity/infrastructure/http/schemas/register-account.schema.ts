import { z } from 'zod';
import type { RegisterAccountCommand } from '../../../application/register-account/register-account.types';

export const registerAccountSchema: z.ZodType<RegisterAccountCommand> = z
  .object({
    email: z.string(),
    password: z.string(),
  })
  .strict();
