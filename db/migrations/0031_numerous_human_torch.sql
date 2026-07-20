CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" "citext" NOT NULL,
	"name" text,
	"role" text NOT NULL,
	"password_hash" text,
	"status" text DEFAULT 'invited' NOT NULL,
	"permissions" jsonb,
	"invited_by_email" text,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
