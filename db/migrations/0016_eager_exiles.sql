ALTER TABLE "email_captures" ADD COLUMN "submission_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_captures" ADD COLUMN "last_submitted_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "email_captures" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "email_captures" ADD COLUMN "device_type" text;--> statement-breakpoint
ALTER TABLE "email_captures" ADD COLUMN "os_name" text;--> statement-breakpoint
ALTER TABLE "email_captures" ADD COLUMN "os_version" text;--> statement-breakpoint
ALTER TABLE "email_captures" ADD COLUMN "browser_name" text;--> statement-breakpoint
ALTER TABLE "email_captures" ADD COLUMN "browser_version" text;--> statement-breakpoint
ALTER TABLE "email_captures" ADD COLUMN "raw_user_agent" text;--> statement-breakpoint
ALTER TABLE "email_captures" ADD COLUMN "referrer" text;--> statement-breakpoint
ALTER TABLE "email_captures" ADD COLUMN "utm_source" text;--> statement-breakpoint
ALTER TABLE "email_captures" ADD COLUMN "utm_medium" text;--> statement-breakpoint
ALTER TABLE "email_captures" ADD COLUMN "utm_campaign" text;