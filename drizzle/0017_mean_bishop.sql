CREATE TABLE "health_pet_veterinary_visits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pet_id" uuid NOT NULL,
	"reason" varchar(255) NOT NULL,
	"visit_date" date NOT NULL,
	"diagnosis" varchar(2000),
	"observations" varchar(5000),
	"recorded_by_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_pet_veterinary_visits_reason_not_empty" CHECK (btrim("health_pet_veterinary_visits"."reason") <> ''),
	CONSTRAINT "health_pet_veterinary_visits_diagnosis_not_empty" CHECK ("health_pet_veterinary_visits"."diagnosis" is null or btrim("health_pet_veterinary_visits"."diagnosis") <> ''),
	CONSTRAINT "health_pet_veterinary_visits_observations_not_empty" CHECK ("health_pet_veterinary_visits"."observations" is null or btrim("health_pet_veterinary_visits"."observations") <> ''),
	CONSTRAINT "health_pet_veterinary_visits_visit_date_range" CHECK ("health_pet_veterinary_visits"."visit_date" between DATE '0001-01-01' and DATE '9999-12-31')
);
--> statement-breakpoint
ALTER TABLE "health_pet_veterinary_visits" ADD CONSTRAINT "health_pet_veterinary_visits_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "public"."pets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_pet_veterinary_visits" ADD CONSTRAINT "health_pet_veterinary_visits_recorded_by_account_id_accounts_id_fk" FOREIGN KEY ("recorded_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "health_pet_veterinary_visits_pet_history_idx" ON "health_pet_veterinary_visits" USING btree ("pet_id","visit_date" DESC NULLS LAST);
--> statement-breakpoint
CREATE TRIGGER health_pet_veterinary_visits_set_updated_at BEFORE UPDATE ON "health_pet_veterinary_visits" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
