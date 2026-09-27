import { sql } from 'drizzle-orm';
import {
  check,
  date,
  numeric,
  pgTable,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { accounts } from '../../../../identity/infrastructure/persistence/drizzle/identity.schema';
import { pets } from '../../../../pet-management/infrastructure/persistence/drizzle/pet-management.schema';

export const healthWeightRecords = pgTable(
  'health_weight_records',
  {
    id: uuid('id').primaryKey(),
    petId: uuid('pet_id')
      .notNull()
      .references(() => pets.id, { onDelete: 'restrict' }),
    weightKg: numeric('weight_kg').notNull(),
    measuredDate: date('measured_date', { mode: 'string' }).notNull(),
    recordedByAccountId: uuid('recorded_by_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'health_weight_records_weight_kg_valid',
      sql`${table.weightKg} > 0 and ${table.weightKg} < 'Infinity'::numeric and scale(${table.weightKg}) <= 4`,
    ),
  ],
);
