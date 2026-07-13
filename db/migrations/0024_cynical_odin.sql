CREATE TYPE "public"."subscription_event_type" AS ENUM('trial_started', 'trial_converted', 'trial_cancelled', 'renewed', 'expired');--> statement-breakpoint
CREATE TABLE "subscription_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type" "subscription_event_type" NOT NULL,
	"product_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"raw_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_raw_event_id_webhook_events_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."webhook_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscription_events_type_occurred_at_idx" ON "subscription_events" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "subscription_events_user_occurred_at_idx" ON "subscription_events" USING btree ("user_id","occurred_at");