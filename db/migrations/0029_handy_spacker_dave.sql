CREATE TYPE "public"."push_campaign_status" AS ENUM('draft', 'scheduled', 'sending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."push_recipient_status" AS ENUM('queued', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "push_campaign_recipients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"push_token" text NOT NULL,
	"status" "push_recipient_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_campaigns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"deep_link" text,
	"segment" jsonb NOT NULL,
	"status" "push_campaign_status" DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"created_by_admin_email" text NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_campaign_recipients" ADD CONSTRAINT "push_campaign_recipients_campaign_id_push_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."push_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_campaign_recipients" ADD CONSTRAINT "push_campaign_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_campaign_recipients_campaign_idx" ON "push_campaign_recipients" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "push_campaigns_status_created_idx" ON "push_campaigns" USING btree ("status","created_at");