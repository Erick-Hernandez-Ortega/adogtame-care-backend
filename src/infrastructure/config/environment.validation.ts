import { z } from 'zod';
import { databaseUrlSchema } from './database-url.schema';

const environmentSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_URL: databaseUrlSchema,
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
    AUTH_THROTTLE_LIMIT: z.coerce.number().int().positive().default(10),
    READINESS_THROTTLE_LIMIT: z.coerce.number().int().positive().default(10),
    LOGIN_ACCOUNT_THROTTLE_LIMIT: z.coerce.number().int().positive().default(10),
    JWT_ACCESS_TOKEN_SECRET: z.string().min(32),
    JWT_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
});

export type EnvironmentVariables = z.infer<typeof environmentSchema>;

export function validateEnvironment(configuration: Record<string, unknown>): EnvironmentVariables {
    const result = environmentSchema.safeParse(configuration);

    if (!result.success) {
        const fields: string[] = [
            ...new Set(result.error.issues.map((issue): string => issue.path.join('.'))),
        ];

        throw new Error(`Invalid environment configuration: ${fields.join(', ')}`);
    }

    return result.data;
}
