import { sql } from 'drizzle-orm';
import {
    check,
    date,
    index,
    numeric,
    pgTable,
    text,
    timestamp,
    uuid,
    varchar,
} from 'drizzle-orm/pg-core';
import { accounts } from '../../../../identity/infrastructure/persistence/drizzle/identity.schema';
import { pets } from '../../../../pet-management/infrastructure/persistence/drizzle/pet-management.schema';

export const healthPetMedicalConditions = pgTable(
    'health_pet_medical_conditions',
    {
        id: uuid('id').primaryKey(),
        petId: uuid('pet_id')
            .notNull()
            .references(() => pets.id, { onDelete: 'restrict' }),
        name: varchar('name', { length: 255 }).notNull(),
        status: text('status').notNull().default('ACTIVE'),
        resolvedDate: date('resolved_date', { mode: 'string' }),
        diagnosedDate: date('diagnosed_date', { mode: 'string' }),
        notes: varchar('notes', { length: 2000 }),
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
            'health_pet_medical_conditions_active_resolved_date_null',
            sql`${table.status} <> 'ACTIVE' OR ${table.resolvedDate} IS NULL`,
        ),
        index('health_pet_medical_conditions_pet_idx').on(table.petId),
        check('health_pet_medical_conditions_name_not_empty', sql`btrim(${table.name}) <> ''`),
        check(
            'health_pet_medical_conditions_status_supported',
            sql`${table.status} in ('ACTIVE', 'RESOLVED')`,
        ),
        check(
            'health_pet_medical_conditions_notes_not_empty',
            sql`${table.notes} is null or btrim(${table.notes}) <> ''`,
        ),
    ],
);

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
        index('health_vaccination_records_pet_history_idx').on(
            table.petId,
            table.appliedDate.desc(),
            table.createdAt.desc(),
            table.id.desc(),
        ),
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

export const healthPetAllergies = pgTable(
    'health_pet_allergies',
    {
        id: uuid('id').primaryKey(),
        petId: uuid('pet_id')
            .notNull()
            .references(() => pets.id, { onDelete: 'restrict' }),
        allergen: varchar('allergen', { length: 255 }).notNull(),
        category: text('category').notNull(),
        severity: text('severity').notNull(),
        notes: varchar('notes', { length: 2000 }),
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
        index('health_pet_allergies_pet_idx').on(table.petId),
        check('health_pet_allergies_allergen_not_empty', sql`btrim(${table.allergen}) <> ''`),
        check(
            'health_pet_allergies_category_supported',
            sql`${table.category} in ('FOOD', 'MEDICATION', 'ENVIRONMENTAL', 'OTHER')`,
        ),
        check(
            'health_pet_allergies_severity_supported',
            sql`${table.severity} in ('MILD', 'MODERATE', 'SEVERE', 'UNKNOWN')`,
        ),
        check(
            'health_pet_allergies_notes_not_empty',
            sql`${table.notes} is null or btrim(${table.notes}) <> ''`,
        ),
    ],
);

export const healthPetMedications = pgTable(
    'health_pet_medications',
    {
        id: uuid('id').primaryKey(),
        status: varchar('status', { length: 12 }).notNull().default('OPEN'),
        endedDate: date('ended_date', { mode: 'string' }),
        discontinuationReason: varchar('discontinuation_reason', { length: 2000 }),
        petId: uuid('pet_id')
            .notNull()
            .references(() => pets.id, { onDelete: 'restrict' }),
        name: varchar('name', { length: 255 }).notNull(),
        dosage: varchar('dosage', { length: 2000 }),
        frequency: varchar('frequency', { length: 2000 }),
        startDate: date('start_date', { mode: 'string' }),
        plannedEndDate: date('planned_end_date', { mode: 'string' }),
        notes: varchar('notes', { length: 2000 }),
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
        index('health_pet_medications_pet_idx').on(table.petId),
        check(
            'health_pet_medications_status_valid',
            sql`${table.status} in ('OPEN', 'COMPLETED', 'DISCONTINUED')`,
        ),
        check(
            'health_pet_medications_open_ended_date_null',
            sql`${table.status} <> 'OPEN' or ${table.endedDate} is null`,
        ),
        check(
            'health_pet_medications_reason_discontinued_only',
            sql`${table.status} = 'DISCONTINUED' or ${table.discontinuationReason} is null`,
        ),
        check(
            'health_pet_medications_reason_not_empty',
            sql`${table.discontinuationReason} is null or btrim(${table.discontinuationReason}) <> ''`,
        ),
        check(
            'health_pet_medications_ended_date_range',
            sql`${table.endedDate} is null or ${table.endedDate} between DATE '0001-01-01' and DATE '9999-12-31'`,
        ),
        check(
            'health_pet_medications_completed_date_after_start',
            sql`${table.status} <> 'COMPLETED' or ${table.startDate} is null or ${table.endedDate} is null or ${table.endedDate} >= ${table.startDate}`,
        ),
        check('health_pet_medications_name_not_empty', sql`btrim(${table.name}) <> ''`),
        check(
            'health_pet_medications_dosage_not_empty',
            sql`${table.dosage} is null or btrim(${table.dosage}) <> ''`,
        ),
        check(
            'health_pet_medications_frequency_not_empty',
            sql`${table.frequency} is null or btrim(${table.frequency}) <> ''`,
        ),
        check(
            'health_pet_medications_notes_not_empty',
            sql`${table.notes} is null or btrim(${table.notes}) <> ''`,
        ),
        check(
            'health_pet_medications_start_date_range',
            sql`${table.startDate} is null or ${table.startDate} between DATE '0001-01-01' and DATE '9999-12-31'`,
        ),
        check(
            'health_pet_medications_planned_end_date_range',
            sql`${table.plannedEndDate} is null or ${table.plannedEndDate} between DATE '0001-01-01' and DATE '9999-12-31'`,
        ),
        check(
            'health_pet_medications_planned_end_date_after_start_date',
            sql`${table.startDate} is null or ${table.plannedEndDate} is null or ${table.plannedEndDate} >= ${table.startDate}`,
        ),
    ],
);

export const healthPetVeterinaryVisits = pgTable(
    'health_pet_veterinary_visits',
    {
        id: uuid('id').primaryKey(),
        petId: uuid('pet_id')
            .notNull()
            .references(() => pets.id, { onDelete: 'restrict' }),
        reason: varchar('reason', { length: 255 }).notNull(),
        visitDate: date('visit_date', { mode: 'string' }).notNull(),
        diagnosis: varchar('diagnosis', { length: 2000 }),
        observations: varchar('observations', { length: 5000 }),
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
        index('health_pet_veterinary_visits_pet_history_idx').on(
            table.petId,
            table.visitDate.desc(),
        ),
        check('health_pet_veterinary_visits_reason_not_empty', sql`btrim(${table.reason}) <> ''`),
        check(
            'health_pet_veterinary_visits_diagnosis_not_empty',
            sql`${table.diagnosis} is null or btrim(${table.diagnosis}) <> ''`,
        ),
        check(
            'health_pet_veterinary_visits_observations_not_empty',
            sql`${table.observations} is null or btrim(${table.observations}) <> ''`,
        ),
        check(
            'health_pet_veterinary_visits_visit_date_range',
            sql`${table.visitDate} between DATE '0001-01-01' and DATE '9999-12-31'`,
        ),
    ],
);
