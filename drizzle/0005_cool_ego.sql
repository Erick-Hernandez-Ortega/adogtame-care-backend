ALTER TABLE "accounts" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pets" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pets" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pet_memberships" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pet_memberships" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
UPDATE "accounts" SET "created_at" = now(), "updated_at" = now();--> statement-breakpoint
UPDATE "pets" SET "created_at" = now(), "updated_at" = now();--> statement-breakpoint
UPDATE "pet_memberships" SET "created_at" = now(), "updated_at" = now();--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pets" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pets" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pet_memberships" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pet_memberships" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "pets" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "pets" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "pet_memberships" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "pet_memberships" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := statement_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER accounts_set_updated_at BEFORE UPDATE ON "accounts" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER pets_set_updated_at BEFORE UPDATE ON "pets" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER pet_memberships_set_updated_at BEFORE UPDATE ON "pet_memberships" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
