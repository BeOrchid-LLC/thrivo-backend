CREATE TABLE "account_erasure_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"auth_subject_id" text,
	"rc_app_user_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error_code" text,
	"completed_at" timestamp with time zone,
	"proof_digest" text
);
--> statement-breakpoint
CREATE TABLE "identity_tombstones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"digest" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "last_webhook_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "account_erasure_status_attempt_idx" ON "account_erasure_requests" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "account_erasure_user_idx" ON "account_erasure_requests" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_tombstones_kind_digest_uniq" ON "identity_tombstones" USING btree ("kind","digest");