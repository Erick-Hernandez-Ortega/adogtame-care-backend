import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  numeric,
  pgTable,
  timestamp,
  uuid,
  varchar,
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

export const healthVaccinationRecords = pgTable(
  'health_vaccination_records',
  {
    id: uuid('id').primaryKey(),
    petId: uuid('pet_id')
      .notNull()
      .references(() => pets.id, { onDelete: 'restrict' }),
    vaccineName: varchar('vaccine_name', { length: 255 }).notNull(),
    appliedDate: date('applied_date', { mode: 'string' }).notNull(),
    nextDueDate: date('next_due_date', { mode: 'string' }),
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
      'health_vaccination_records_vaccine_name_not_empty',
      sql`btrim(${table.vaccineName}) <> ''`,
    ),
    check(
      'health_vaccination_records_next_due_date_after_applied_date',
      sql`${table.nextDueDate} is null or ${table.nextDueDate} > ${table.appliedDate}`,
    ),
  ],
);
