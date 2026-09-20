import { sql } from 'drizzle-orm';
import { check, date, pgTable, text, uuid } from 'drizzle-orm/pg-core';

export const pets = pgTable(
  'pets',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    species: text('species').notNull(),
    breedName: text('breed_name').notNull(),
    breedKind: text('breed_kind').notNull(),
    sex: text('sex').notNull(),
    birthDate: date('birth_date', { mode: 'string' }).notNull(),
    birthDateAccuracy: text('birth_date_accuracy').notNull(),
    color: text('color'),
    distinctiveMarks: text('distinctive_marks'),
    microchip: text('microchip'),
    status: text('status').notNull(),
  },
  (table) => [
    check('pets_name_not_empty', sql`btrim(${table.name}) <> ''`),
    check('pets_species_supported', sql`${table.species} in ('DOG', 'CAT')`),
    check('pets_breed_name_not_empty', sql`btrim(${table.breedName}) <> ''`),
    check(
      'pets_breed_kind_supported',
      sql`${table.breedKind} in ('KNOWN', 'CUSTOM')`,
    ),
    check(
      'pets_sex_supported',
      sql`${table.sex} in ('MALE', 'FEMALE', 'UNKNOWN')`,
    ),
    check(
      'pets_birth_date_accuracy_supported',
      sql`${table.birthDateAccuracy} in ('EXACT', 'APPROXIMATE')`,
    ),
    check(
      'pets_color_not_empty',
      sql`${table.color} is null or btrim(${table.color}) <> ''`,
    ),
    check(
      'pets_distinctive_marks_not_empty',
      sql`${table.distinctiveMarks} is null or btrim(${table.distinctiveMarks}) <> ''`,
    ),
    check(
      'pets_microchip_not_empty',
      sql`${table.microchip} is null or btrim(${table.microchip}) <> ''`,
    ),
    check(
      'pets_status_supported',
      sql`${table.status} in ('ACTIVE', 'ARCHIVED')`,
    ),
  ],
);

export const petMemberships = pgTable(
  'pet_memberships',
  {
    id: uuid('id').primaryKey(),
    petId: uuid('pet_id')
      .notNull()
      .references(() => pets.id, { onDelete: 'restrict' }),
    accountId: uuid('account_id').notNull(),
    role: text('role').notNull(),
  },
  (table) => [
    check(
      'pet_memberships_role_supported',
      sql`${table.role} in ('OWNER', 'COLLABORATOR')`,
    ),
  ],
);
