CREATE TABLE "health_pet_allergies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pet_id" uuid NOT NULL,
	"allergen" varchar(255) NOT NULL,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"notes" varchar(2000),
	"recorded_by_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_pet_allergies_allergen_not_empty" CHECK (btrim("health_pet_allergies"."allergen") <> ''),
	CONSTRAINT "health_pet_allergies_category_supported" CHECK ("health_pet_allergies"."category" in ('FOOD', 'MEDICATION', 'ENVIRONMENTAL', 'OTHER')),
	CONSTRAINT "health_pet_allergies_severity_supported" CHECK ("health_pet_allergies"."severity" in ('MILD', 'MODERATE', 'SEVERE', 'UNKNOWN')),
	CONSTRAINT "health_pet_allergies_notes_not_empty" CHECK ("health_pet_allergies"."notes" is null or btrim("health_pet_allergies"."notes") <> '')
);
--> statement-breakpoint
ALTER TABLE "health_pet_allergies" ADD CONSTRAINT "health_pet_allergies_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "public"."pets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_pet_allergies" ADD CONSTRAINT "health_pet_allergies_recorded_by_account_id_accounts_id_fk" FOREIGN KEY ("recorded_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE TRIGGER health_pet_allergies_set_updated_at BEFORE UPDATE ON "health_pet_allergies" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
