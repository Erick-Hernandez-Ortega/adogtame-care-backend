ALTER TABLE "pet_invitations" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
CREATE TRIGGER pet_invitations_set_updated_at BEFORE UPDATE ON "pet_invitations" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
