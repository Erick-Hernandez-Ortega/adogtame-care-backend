import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { accounts } from '../../../../identity/infrastructure/persistence/drizzle/identity.schema';
import { pets } from '../../../../pet-management/infrastructure/persistence/drizzle/pet-management.schema';

export const careRoutines = pgTable(
    'care_routines',
    {
        id: uuid('id').primaryKey(),
        petId: uuid('pet_id')
            .notNull()
            .references(() => pets.id, { onDelete: 'restrict' }),
        type: text('type').notNull(),
        title: varchar('title', { length: 255 }).notNull(),
        instructions: varchar('instructions', { length: 2000 }),
        frequencyPeriod: text('frequency_period').notNull(),
        timesPerPeriod: bigint('times_per_period', { mode: 'number' }).notNull(),
        suggestedTimes: text('suggested_times')
            .array()
            .notNull()
            .default(sql`'{}'::text[]`),
        weekdays: text('weekdays')
            .array()
            .notNull()
            .default(sql`'{}'::text[]`),
        timezone: text('timezone').notNull(),
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
        index('care_routines_pet_idx').on(table.petId),
        check(
            'care_routines_type_supported',
            sql`${table.type} in ('FEEDING', 'WALK', 'HYGIENE', 'OTHER')`,
        ),
        check('care_routines_title_not_empty', sql`btrim(${table.title}) <> ''`),
        check(
            'care_routines_instructions_not_empty',
            sql`${table.instructions} is null or btrim(${table.instructions}) <> ''`,
        ),
        check(
            'care_routines_period_supported',
            sql`${table.frequencyPeriod} in ('DAILY', 'WEEKLY')`,
        ),
        check(
            'care_routines_times_per_period_valid',
            sql`${table.timesPerPeriod} between 1 and 9007199254740991`,
        ),
        check(
            'care_routines_suggested_times_valid',
            sql`array_ndims(${table.suggestedTimes}) is null or (array_ndims(${table.suggestedTimes}) = 1 and array_position(${table.suggestedTimes}, null) is null and not jsonb_path_exists(to_jsonb(${table.suggestedTimes}), '$[*] ? (!(@ like_regex "^([01][0-9]|2[0-3]):[0-5][0-9]$"))'))`,
        ),
        check(
            'care_routines_weekdays_valid',
            sql`array_ndims(${table.weekdays}) is null or (array_ndims(${table.weekdays}) = 1 and array_position(${table.weekdays}, null) is null and ${table.weekdays} <@ ARRAY['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']::text[])`,
        ),
        check(
            'care_routines_weekdays_weekly_only',
            sql`${table.frequencyPeriod} = 'WEEKLY' or cardinality(${table.weekdays}) = 0`,
        ),
        check('care_routines_timezone_not_empty', sql`btrim(${table.timezone}) <> ''`),
    ],
);

export const careActivities = pgTable(
    'care_activities',
    {
        id: uuid('id').primaryKey(),
        petId: uuid('pet_id')
            .notNull()
            .references(() => pets.id, { onDelete: 'restrict' }),
        routineId: uuid('routine_id')
            .notNull()
            .references(() => careRoutines.id, { onDelete: 'restrict' }),
        completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }).notNull(),
        completedBy: uuid('completed_by')
            .notNull()
            .references(() => accounts.id, { onDelete: 'restrict' }),
        timezone: text('timezone').notNull(),
        notes: varchar('notes', { length: 2000 }),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        index('care_activities_pet_routine_idx').on(table.petId, table.routineId),
        check('care_activities_timezone_not_empty', sql`btrim(${table.timezone}) <> ''`),
        check(
            'care_activities_notes_not_empty',
            sql`${table.notes} is null or btrim(${table.notes}) <> ''`,
        ),
        check(
            'care_activities_completed_at_range',
            sql`${table.completedAt} >= TIMESTAMPTZ '0001-01-01 00:00:00+00' and ${table.completedAt} < TIMESTAMPTZ '10000-01-01 00:00:00+00'`,
        ),
    ],
);
