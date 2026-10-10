import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const accounts = pgTable(
    'accounts',
    {
        id: uuid('id').primaryKey(),
        email: text('email').notNull(),
        passwordHash: text('password_hash').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        unique('accounts_email_unique').on(table.email),
        check('accounts_email_not_empty', sql`btrim(${table.email}) <> ''`),
        check('accounts_password_hash_not_empty', sql`btrim(${table.passwordHash}) <> ''`),
    ],
);
