ALTER TYPE "public"."push_recipient_status" ADD VALUE 'processing' BEFORE 'sent';--> statement-breakpoint
ALTER TABLE "push_campaign_recipients" ADD COLUMN "processing_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "push_campaign_recipients" ADD COLUMN "processing_token" text;--> statement-breakpoint
CREATE INDEX "push_campaign_recipients_claim_idx" ON "push_campaign_recipients" USING btree ("campaign_id","status","processing_at");