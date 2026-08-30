CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'qualified', 'converted', 'unsubscribed', 'spam');--> statement-breakpoint
ALTER TYPE "public"."email_kind" ADD VALUE 'lead_contact' BEFORE 'legacy_notification';--> statement-breakpoint
ALTER TYPE "public"."push_campaign_status" ADD VALUE 'canceled';--> statement-breakpoint
CREATE TABLE "email_replay_payloads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email_log_id" uuid NOT NULL,
	"encryption_key_id" text NOT NULL,
	"payload_iv" text NOT NULL,
	"payload_auth_tag" text NOT NULL,
	"payload_ciphertext" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_replay_payloads_email_log_id_unique" UNIQUE("email_log_id")
);
--> statement-breakpoint
CREATE TABLE "lead_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"author_admin_email" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_captures" ADD COLUMN "status" "lead_status" DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_captures" ADD COLUMN "owner_admin_email" text;--> statement-breakpoint
ALTER TABLE "email_captures" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "email_captures" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "email_logs" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "email_logs" ADD COLUMN "parent_email_log_id" uuid;--> statement-breakpoint
ALTER TABLE "email_logs" ADD COLUMN "resendable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "email_replay_payloads" ADD CONSTRAINT "email_replay_payloads_email_log_id_email_logs_id_fk" FOREIGN KEY ("email_log_id") REFERENCES "public"."email_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_lead_id_email_captures_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."email_captures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_replay_payloads_expiry_idx" ON "email_replay_payloads" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "lead_notes_lead_created_idx" ON "lead_notes" USING btree ("lead_id","created_at");--> statement-breakpoint
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_lead_id_email_captures_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."email_captures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_captures_status_owner_idx" ON "email_captures" USING btree ("status","owner_admin_email");--> statement-breakpoint
CREATE INDEX "email_logs_lead_created_idx" ON "email_logs" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "email_logs_parent_idx" ON "email_logs" USING btree ("parent_email_log_id");