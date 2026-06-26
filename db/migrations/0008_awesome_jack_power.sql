CREATE TABLE "global_settings" (
	"key" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"push_notifications_enabled" boolean DEFAULT true NOT NULL,
	"daily_food_log_reminder_enabled" boolean DEFAULT true NOT NULL,
	"weight_check_reminder_enabled" boolean DEFAULT true NOT NULL,
	"hydration_reminder_enabled" boolean DEFAULT true NOT NULL,
	"subscriptions_enabled" boolean DEFAULT true NOT NULL,
	"trials_enabled" boolean DEFAULT true NOT NULL,
	"purchases_enabled" boolean DEFAULT true NOT NULL,
	"cancellations_enabled" boolean DEFAULT true NOT NULL,
	"trial_days" integer DEFAULT 14 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"unit_system" text DEFAULT 'metric' NOT NULL,
	"push_notifications_enabled" boolean DEFAULT true NOT NULL,
	"daily_food_log_reminder_enabled" boolean DEFAULT true NOT NULL,
	"daily_food_log_reminder_time" text DEFAULT '08:00' NOT NULL,
	"weight_check_reminder_enabled" boolean DEFAULT true NOT NULL,
	"weight_check_reminder_day" text DEFAULT 'friday' NOT NULL,
	"weight_check_reminder_time" text DEFAULT '09:00' NOT NULL,
	"hydration_reminder_enabled" boolean DEFAULT true NOT NULL,
	"hydration_reminder_interval_minutes" integer DEFAULT 40 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_settings_user_id_uniq" ON "user_settings" USING btree ("user_id");