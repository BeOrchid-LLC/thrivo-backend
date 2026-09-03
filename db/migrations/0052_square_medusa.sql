ALTER TYPE "public"."email_kind" ADD VALUE 'account_deletion' BEFORE 'legacy_notification';--> statement-breakpoint
CREATE TABLE "account_deletion_web_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"erasure_request_id" uuid
);
--> statement-breakpoint
ALTER TABLE "account_deletion_web_requests" ADD CONSTRAINT "account_deletion_web_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_deletion_web_requests" ADD CONSTRAINT "account_deletion_web_requests_erasure_request_id_account_erasure_requests_id_fk" FOREIGN KEY ("erasure_request_id") REFERENCES "public"."account_erasure_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_deletion_web_requests_token_hash_uniq" ON "account_deletion_web_requests" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "account_deletion_web_requests_user_idx" ON "account_deletion_web_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "account_deletion_web_requests_status_expiry_idx" ON "account_deletion_web_requests" USING btree ("status","expires_at");