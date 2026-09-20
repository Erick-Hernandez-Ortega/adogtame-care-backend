import { z } from 'zod';

export const databaseUrlSchema = z
  .string()
  .url()
  .regex(/^postgres(?:ql)?:\/\//, {
    message: 'DATABASE_URL must use the postgres:// or postgresql:// protocol',
  });
