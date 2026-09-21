CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	CONSTRAINT "accounts_email_unique" UNIQUE("email"),
	CONSTRAINT "accounts_email_not_empty" CHECK (btrim("accounts"."email") <> ''),
	CONSTRAINT "accounts_password_hash_not_empty" CHECK (btrim("accounts"."password_hash") <> '')
);
