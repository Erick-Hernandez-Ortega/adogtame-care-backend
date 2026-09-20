import { z } from 'zod';
import { databaseUrlSchema } from './database-url.schema';

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: databaseUrlSchema,
});

export type EnvironmentVariables = z.infer<typeof environmentSchema>;

export function validateEnvironment(
  configuration: Record<string, unknown>,
): EnvironmentVariables {
  return environmentSchema.parse(configuration);
}
