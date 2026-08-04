CREATE TYPE "public"."email_kind" AS ENUM('welcome', 'weekly_review', 'trial_ending', 'cancellation_confirmation', 'admin_otp', 'admin_invite', 'admin_password_reset', 'legacy_notification');--> statement-breakpoint
CREATE TYPE "public"."email_outbox_state" AS ENUM('pending', 'dispatching', 'dispatched', 'completed', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."email_suppression_reason" AS ENUM('complained', 'provider_suppressed', 'permanent_bounce');--> statement-breakpoint
-- PostgreSQL does not allow a value introduced by ALTER TYPE ... ADD VALUE to
-- be used before the surrounding transaction commits. Drizzle applies every
-- pending migration in one transaction, so rebuild the enum transactionally
-- before this migration updates legacy rows to the new expired status.
ALTER TABLE "email_logs" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "public"."email_status" RENAME TO "email_status_legacy";--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('queued', 'processing', 'retrying', 'sent', 'delivered', 'bounced', 'complained', 'suppressed', 'failed', 'expired');--> statement-breakpoint
ALTER TABLE "email_logs" ALTER COLUMN "status" TYPE "public"."email_status" USING "status"::text::"public"."email_status";--> statement-breakpoint
ALTER TABLE "email_logs" ALTER COLUMN "status" SET DEFAULT 'queued';--> statement-breakpoint
DROP TYPE "public"."email_status_legacy";--> statement-breakpoint
ALTER TYPE "public"."webhook_provider" ADD VALUE 'resend';--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email_log_id" uuid NOT NULL,
	"state" "email_outbox_state" DEFAULT 'pending' NOT NULL,
	"encryption_key_id" text NOT NULL,
	"payload_iv" text,
	"payload_auth_tag" text,
	"payload_ciphertext" text,
	"expires_at" timestamp with time zone NOT NULL,
	"dispatch_started_at" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" "citext" NOT NULL,
	"reason" "email_suppression_reason" NOT NULL,
	"provider_event_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"suppressed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "global_settings" ADD COLUMN "weekly_review_email_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "weekly_review_email_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "email_logs" ADD COLUMN "kind" "email_kind" DEFAULT 'legacy_notification' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_logs" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "email_logs" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_logs" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_logs" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_logs" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_logs" ADD COLUMN "failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_logs" ADD COLUMN "provider_event_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_logs" ADD COLUMN "failure_code" text;--> statement-breakpoint
-- Existing domain users came from the previously verified Clerk/auth flow. New rows
-- default false and are promoted only from Clerk's declared primary address state.
UPDATE "users" SET "email_verified" = true;--> statement-breakpoint
UPDATE "global_settings"
SET "weekly_review_email_enabled" = "email_food_log_reminder_enabled";--> statement-breakpoint
UPDATE "user_settings"
SET "weekly_review_email_enabled" = "email_food_log_reminder_enabled";--> statement-breakpoint
UPDATE "email_logs"
SET "kind" = CASE
  WHEN "template" = 'weekly-review' THEN 'weekly_review'::"email_kind"
  WHEN "template" = 'otp' THEN 'admin_otp'::"email_kind"
  WHEN "template" = 'admin-invite' THEN 'admin_invite'::"email_kind"
  WHEN "template" = 'admin-password-reset' THEN 'admin_password_reset'::"email_kind"
  ELSE 'legacy_notification'::"email_kind"
END;--> statement-breakpoint
-- Old queued rows have no recoverable durable payload.
UPDATE "email_logs"
SET "status" = 'expired',
    "failure_code" = 'legacy_payload_unavailable',
    "failed_at" = now()
WHERE "status" = 'queued';--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_email_log_id_email_logs_id_fk" FOREIGN KEY ("email_log_id") REFERENCES "public"."email_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_email_log_uniq" ON "email_outbox" USING btree ("email_log_id");--> statement-breakpoint
CREATE INDEX "email_outbox_state_expiry_idx" ON "email_outbox" USING btree ("state","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_suppressions_email_uniq" ON "email_suppressions" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "email_logs_kind_dedupe_uniq" ON "email_logs" USING btree ("kind","dedupe_key") WHERE "email_logs"."dedupe_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "email_logs_provider_message_uniq" ON "email_logs" USING btree ("provider_message_id") WHERE "email_logs"."provider_message_id" is not null;
