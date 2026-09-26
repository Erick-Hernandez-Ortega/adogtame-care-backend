ALTER TABLE "pet_memberships" ADD COLUMN "status" text;--> statement-breakpoint
UPDATE "pet_memberships" SET "status" = 'ACTIVE';--> statement-breakpoint
ALTER TABLE "pet_memberships" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pet_memberships" ADD CONSTRAINT "pet_memberships_status_supported" CHECK ("pet_memberships"."status" in ('ACTIVE', 'INACTIVE'));--> statement-breakpoint
ALTER TABLE "pet_memberships" ADD CONSTRAINT "pet_memberships_pet_id_account_id_unique" UNIQUE("pet_id","account_id");
