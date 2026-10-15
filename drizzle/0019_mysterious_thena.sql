CREATE TABLE "care_activities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pet_id" uuid NOT NULL,
	"routine_id" uuid NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"completed_by" uuid NOT NULL,
	"timezone" text NOT NULL,
	"notes" varchar(2000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "care_activities_timezone_not_empty" CHECK (btrim("care_activities"."timezone") <> ''),
	CONSTRAINT "care_activities_notes_not_empty" CHECK ("care_activities"."notes" is null or btrim("care_activities"."notes") <> ''),
	CONSTRAINT "care_activities_completed_at_range" CHECK ("care_activities"."completed_at" >= TIMESTAMPTZ '0001-01-01 00:00:00+00' and "care_activities"."completed_at" < TIMESTAMPTZ '10000-01-01 00:00:00+00')
);
--> statement-breakpoint
ALTER TABLE "care_activities" ADD CONSTRAINT "care_activities_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "public"."pets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_activities" ADD CONSTRAINT "care_activities_routine_id_care_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."care_routines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_activities" ADD CONSTRAINT "care_activities_completed_by_accounts_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "care_activities_pet_routine_idx" ON "care_activities" USING btree ("pet_id","routine_id");--> statement-breakpoint
CREATE TRIGGER care_activities_set_updated_at BEFORE UPDATE ON "care_activities" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
