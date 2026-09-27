CREATE TABLE "health_weight_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pet_id" uuid NOT NULL,
	"weight_kg" numeric NOT NULL,
	"measured_date" date NOT NULL,
	"recorded_by_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_weight_records_weight_kg_valid" CHECK ("health_weight_records"."weight_kg" > 0 and "health_weight_records"."weight_kg" < 'Infinity'::numeric and scale("health_weight_records"."weight_kg") <= 4)
);
--> statement-breakpoint
ALTER TABLE "health_weight_records" ADD CONSTRAINT "health_weight_records_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "public"."pets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_weight_records" ADD CONSTRAINT "health_weight_records_recorded_by_account_id_accounts_id_fk" FOREIGN KEY ("recorded_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER health_weight_records_set_updated_at BEFORE UPDATE ON "health_weight_records" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
