CREATE TABLE "health_pet_medical_conditions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pet_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"diagnosed_date" date,
	"notes" varchar(2000),
	"recorded_by_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_pet_medical_conditions_name_not_empty" CHECK (btrim("health_pet_medical_conditions"."name") <> ''),
	CONSTRAINT "health_pet_medical_conditions_status_supported" CHECK ("health_pet_medical_conditions"."status" in ('ACTIVE', 'RESOLVED')),
	CONSTRAINT "health_pet_medical_conditions_notes_not_empty" CHECK ("health_pet_medical_conditions"."notes" is null or btrim("health_pet_medical_conditions"."notes") <> '')
);
--> statement-breakpoint
ALTER TABLE "health_pet_medical_conditions" ADD CONSTRAINT "health_pet_medical_conditions_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "public"."pets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_pet_medical_conditions" ADD CONSTRAINT "health_pet_medical_conditions_recorded_by_account_id_accounts_id_fk" FOREIGN KEY ("recorded_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE TRIGGER health_pet_medical_conditions_set_updated_at BEFORE UPDATE ON "health_pet_medical_conditions" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
