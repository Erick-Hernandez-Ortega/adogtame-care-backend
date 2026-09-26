CREATE TABLE "pet_invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pet_id" uuid NOT NULL,
	"invited_email" text NOT NULL,
	"invited_by_account_id" uuid NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pet_invitations_email_normalized" CHECK ("pet_invitations"."invited_email" <> '' and "pet_invitations"."invited_email" = lower(btrim("pet_invitations"."invited_email"))),
	CONSTRAINT "pet_invitations_status_supported" CHECK ("pet_invitations"."status" in ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED')),
	CONSTRAINT "pet_invitations_expires_after_created" CHECK ("pet_invitations"."expires_at" > "pet_invitations"."created_at")
);
--> statement-breakpoint
ALTER TABLE "pet_invitations" ADD CONSTRAINT "pet_invitations_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "public"."pets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pet_invitations_one_pending_per_email" ON "pet_invitations" USING btree ("pet_id","invited_email") WHERE "pet_invitations"."status" = 'PENDING';
