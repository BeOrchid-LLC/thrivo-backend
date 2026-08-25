CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"local_date" date NOT NULL,
	"scheduled_time" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "global_settings" ADD COLUMN "psychology_tip_push_enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "psychology_tip_push_enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_deliveries"
	ADD CONSTRAINT "notification_deliveries_user_id_users_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_user_kind_time_uniq"
	ON "notification_deliveries" USING btree ("user_id", "kind", "local_date", "scheduled_time");
