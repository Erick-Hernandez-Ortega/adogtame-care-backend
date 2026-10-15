CREATE TABLE "care_routines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pet_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" varchar(255) NOT NULL,
	"instructions" varchar(2000),
	"frequency_period" text NOT NULL,
	"times_per_period" bigint NOT NULL,
	"suggested_times" text[] DEFAULT '{}'::text[] NOT NULL,
	"weekdays" text[] DEFAULT '{}'::text[] NOT NULL,
	"timezone" text NOT NULL,
	"recorded_by_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "care_routines_type_supported" CHECK ("care_routines"."type" in ('FEEDING', 'WALK', 'HYGIENE', 'OTHER')),
	CONSTRAINT "care_routines_title_not_empty" CHECK (btrim("care_routines"."title") <> ''),
	CONSTRAINT "care_routines_instructions_not_empty" CHECK ("care_routines"."instructions" is null or btrim("care_routines"."instructions") <> ''),
	CONSTRAINT "care_routines_period_supported" CHECK ("care_routines"."frequency_period" in ('DAILY', 'WEEKLY')),
	CONSTRAINT "care_routines_times_per_period_valid" CHECK ("care_routines"."times_per_period" between 1 and 9007199254740991),
	CONSTRAINT "care_routines_suggested_times_valid" CHECK (array_ndims("care_routines"."suggested_times") is null or (array_ndims("care_routines"."suggested_times") = 1 and array_position("care_routines"."suggested_times", null) is null and not jsonb_path_exists(to_jsonb("care_routines"."suggested_times"), '$[*] ? (!(@ like_regex "^([01][0-9]|2[0-3]):[0-5][0-9]$"))'))),
	CONSTRAINT "care_routines_weekdays_valid" CHECK (array_ndims("care_routines"."weekdays") is null or (array_ndims("care_routines"."weekdays") = 1 and array_position("care_routines"."weekdays", null) is null and "care_routines"."weekdays" <@ ARRAY['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']::text[])),
	CONSTRAINT "care_routines_weekdays_weekly_only" CHECK ("care_routines"."frequency_period" = 'WEEKLY' or cardinality("care_routines"."weekdays") = 0),
	CONSTRAINT "care_routines_timezone_not_empty" CHECK (btrim("care_routines"."timezone") <> '')
);
--> statement-breakpoint
ALTER TABLE "care_routines" ADD CONSTRAINT "care_routines_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "public"."pets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_routines" ADD CONSTRAINT "care_routines_recorded_by_account_id_accounts_id_fk" FOREIGN KEY ("recorded_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "care_routines_pet_idx" ON "care_routines" USING btree ("pet_id");
--> statement-breakpoint
CREATE TRIGGER care_routines_set_updated_at BEFORE UPDATE ON "care_routines" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
