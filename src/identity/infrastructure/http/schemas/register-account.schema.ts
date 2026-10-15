import { z } from 'zod';
import type { RegisterAccountCommand } from '../../../application/register-account/register-account.types';

export const registerAccountSchema: z.ZodType<RegisterAccountCommand> = z
    .object({
        email: z.string().max(508),
        password: z.string().max(256),
    })
    .strict();
