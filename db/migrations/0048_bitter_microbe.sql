CREATE TABLE "admin_action_idempotency" (
	"id" uuid PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"target_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"response" jsonb,
	"response_message" text NOT NULL,
	"response_status" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "admin_action_idempotency_action_target_key_uniq" ON "admin_action_idempotency" USING btree ("action","target_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "admin_action_idempotency_expiry_idx" ON "admin_action_idempotency" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_parent_email_log_id_email_logs_id_fk" FOREIGN KEY ("parent_email_log_id") REFERENCES "public"."email_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "push_campaign_recipients_campaign_token_uniq" ON "push_campaign_recipients" USING btree ("campaign_id","push_token");