CREATE TABLE "health_pet_medications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pet_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"dosage" varchar(2000),
	"frequency" varchar(2000),
	"start_date" date,
	"planned_end_date" date,
	"notes" varchar(2000),
	"recorded_by_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_pet_medications_name_not_empty" CHECK (btrim("health_pet_medications"."name") <> ''),
	CONSTRAINT "health_pet_medications_dosage_not_empty" CHECK ("health_pet_medications"."dosage" is null or btrim("health_pet_medications"."dosage") <> ''),
	CONSTRAINT "health_pet_medications_frequency_not_empty" CHECK ("health_pet_medications"."frequency" is null or btrim("health_pet_medications"."frequency") <> ''),
	CONSTRAINT "health_pet_medications_notes_not_empty" CHECK ("health_pet_medications"."notes" is null or btrim("health_pet_medications"."notes") <> ''),
	CONSTRAINT "health_pet_medications_start_date_range" CHECK ("health_pet_medications"."start_date" is null or "health_pet_medications"."start_date" between DATE '0001-01-01' and DATE '9999-12-31'),
	CONSTRAINT "health_pet_medications_planned_end_date_range" CHECK ("health_pet_medications"."planned_end_date" is null or "health_pet_medications"."planned_end_date" between DATE '0001-01-01' and DATE '9999-12-31'),
	CONSTRAINT "health_pet_medications_planned_end_date_after_start_date" CHECK ("health_pet_medications"."start_date" is null or "health_pet_medications"."planned_end_date" is null or "health_pet_medications"."planned_end_date" >= "health_pet_medications"."start_date")
);
--> statement-breakpoint
ALTER TABLE "health_pet_medications" ADD CONSTRAINT "health_pet_medications_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "public"."pets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_pet_medications" ADD CONSTRAINT "health_pet_medications_recorded_by_account_id_accounts_id_fk" FOREIGN KEY ("recorded_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "health_pet_medications_pet_idx" ON "health_pet_medications" USING btree ("pet_id");
--> statement-breakpoint
CREATE TRIGGER health_pet_medications_set_updated_at BEFORE UPDATE ON "health_pet_medications" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
