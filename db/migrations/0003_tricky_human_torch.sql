ALTER TYPE "public"."sex" ADD VALUE 'prefer_not_to_say';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "activity_level" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "manual_daily_target_kcal" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "account_status" text DEFAULT 'dormant' NOT NULL;