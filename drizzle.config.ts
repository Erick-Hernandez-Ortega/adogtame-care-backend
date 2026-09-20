import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';
import { databaseUrlSchema } from './src/infrastructure/config/database-url.schema';

const databaseUrl: string = databaseUrlSchema.parse(process.env.DATABASE_URL);

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/*/infrastructure/persistence/drizzle/*.schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: databaseUrl,
  },
});
