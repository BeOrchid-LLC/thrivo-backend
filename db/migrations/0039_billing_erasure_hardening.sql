ALTER TYPE "public"."sub_status" ADD VALUE IF NOT EXISTS 'none';--> statement-breakpoint

ALTER TABLE "account_erasure_requests"
  ADD COLUMN IF NOT EXISTS "consecutive_failures" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "phase" text DEFAULT 'external_deletion' NOT NULL,
  ADD COLUMN IF NOT EXISTS "processing_started_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp with time zone;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "account_erasure_requests"
    WHERE "status" NOT IN ('pending', 'processing', 'retryable', 'failed', 'completed')
  ) THEN
    RAISE EXCEPTION 'account_erasure_requests contains an unknown status';
  END IF;
  IF EXISTS (
    SELECT "user_id" FROM "account_erasure_requests"
    WHERE "user_id" IS NOT NULL
    GROUP BY "user_id" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate account erasure requests exist for a user; resolve before migration';
  END IF;
  IF EXISTS (
    SELECT "auth_subject_id" FROM "account_erasure_requests"
    WHERE "auth_subject_id" IS NOT NULL
    GROUP BY "auth_subject_id" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate account erasure requests exist for an auth subject; resolve before migration';
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "account_erasure_requests"
  ADD CONSTRAINT "account_erasure_status_check"
  CHECK ("status" IN ('pending', 'processing', 'retryable', 'failed', 'completed'));--> statement-breakpoint
ALTER TABLE "account_erasure_requests"
  ADD CONSTRAINT "account_erasure_phase_check"
  CHECK ("phase" IN ('external_deletion', 'upload_wait', 'r2_deletion', 'redaction', 'domain_deletion', 'finalization'));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "account_erasure_open_user_uniq"
  ON "account_erasure_requests" ("user_id") WHERE "user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "account_erasure_open_auth_subject_uniq"
  ON "account_erasure_requests" ("auth_subject_id") WHERE "auth_subject_id" IS NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "webhook_identity_ownership" (
  "id" uuid PRIMARY KEY NOT NULL,
  "webhook_event_id" uuid NOT NULL REFERENCES "webhook_events"("id") ON DELETE CASCADE,
  "identity_digest" text NOT NULL,
  "resolved_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_identity_event_digest_uniq"
  ON "webhook_identity_ownership" ("webhook_event_id", "identity_digest");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_identity_digest_idx"
  ON "webhook_identity_ownership" ("identity_digest");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_identity_resolved_user_idx"
  ON "webhook_identity_ownership" ("resolved_user_id");--> statement-breakpoint

UPDATE "subscription_events"
SET "currency" = CASE
  WHEN upper(trim("currency")) ~ '^[A-Z]{3}$' THEN upper(trim("currency"))
  ELSE NULL
END
WHERE "currency" IS NOT NULL;
