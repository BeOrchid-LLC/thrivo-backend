ALTER TABLE "admin_users" ADD COLUMN "clerk_admin_id" text;--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_clerk_admin_id_unique" UNIQUE("clerk_admin_id");