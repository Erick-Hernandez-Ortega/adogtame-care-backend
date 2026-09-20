CREATE TABLE "pet_memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pet_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "pet_memberships_role_supported" CHECK ("pet_memberships"."role" in ('OWNER', 'COLLABORATOR'))
);
--> statement-breakpoint
CREATE TABLE "pets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"species" text NOT NULL,
	"breed_name" text NOT NULL,
	"breed_kind" text NOT NULL,
	"sex" text NOT NULL,
	"birth_date" date NOT NULL,
	"birth_date_accuracy" text NOT NULL,
	"color" text,
	"distinctive_marks" text,
	"microchip" text,
	"status" text NOT NULL,
	CONSTRAINT "pets_name_not_empty" CHECK (btrim("pets"."name") <> ''),
	CONSTRAINT "pets_species_supported" CHECK ("pets"."species" in ('DOG', 'CAT')),
	CONSTRAINT "pets_breed_name_not_empty" CHECK (btrim("pets"."breed_name") <> ''),
	CONSTRAINT "pets_breed_kind_supported" CHECK ("pets"."breed_kind" in ('KNOWN', 'CUSTOM')),
	CONSTRAINT "pets_sex_supported" CHECK ("pets"."sex" in ('MALE', 'FEMALE', 'UNKNOWN')),
	CONSTRAINT "pets_birth_date_accuracy_supported" CHECK ("pets"."birth_date_accuracy" in ('EXACT', 'APPROXIMATE')),
	CONSTRAINT "pets_color_not_empty" CHECK ("pets"."color" is null or btrim("pets"."color") <> ''),
	CONSTRAINT "pets_distinctive_marks_not_empty" CHECK ("pets"."distinctive_marks" is null or btrim("pets"."distinctive_marks") <> ''),
	CONSTRAINT "pets_microchip_not_empty" CHECK ("pets"."microchip" is null or btrim("pets"."microchip") <> ''),
	CONSTRAINT "pets_status_supported" CHECK ("pets"."status" in ('ACTIVE', 'ARCHIVED'))
);
--> statement-breakpoint
ALTER TABLE "pet_memberships" ADD CONSTRAINT "pet_memberships_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "public"."pets"("id") ON DELETE restrict ON UPDATE no action;