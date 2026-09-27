CREATE TABLE "health_vaccination_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pet_id" uuid NOT NULL,
	"vaccine_name" varchar(255) NOT NULL,
	"applied_date" date NOT NULL,
	"next_due_date" date,
	"recorded_by_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_vaccination_records_vaccine_name_not_empty" CHECK (btrim("health_vaccination_records"."vaccine_name") <> ''),
	CONSTRAINT "health_vaccination_records_next_due_date_after_applied_date" CHECK ("health_vaccination_records"."next_due_date" is null or "health_vaccination_records"."next_due_date" > "health_vaccination_records"."applied_date")
);
--> statement-breakpoint
ALTER TABLE "health_vaccination_records" ADD CONSTRAINT "health_vaccination_records_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "public"."pets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_vaccination_records" ADD CONSTRAINT "health_vaccination_records_recorded_by_account_id_accounts_id_fk" FOREIGN KEY ("recorded_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER health_vaccination_records_set_updated_at BEFORE UPDATE ON "health_vaccination_records" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
