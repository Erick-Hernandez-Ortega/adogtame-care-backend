import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
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
    index('health_weight_records_pet_history_idx').on(
      table.petId,
      table.measuredDate.desc(),
      table.createdAt.desc(),
      table.id.desc(),
    ),
    check(
      'health_weight_records_weight_kg_valid',
      sql`${table.weightKg} > 0 and ${table.weightKg} < 'Infinity'::numeric and scale(${table.weightKg}) <= 4`,
    ),
  ],
);
