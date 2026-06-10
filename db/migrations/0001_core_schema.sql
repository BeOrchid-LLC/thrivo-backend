DO $$ BEGIN
 CREATE TYPE "public"."email_status" AS ENUM('queued', 'sent', 'delivered', 'bounced', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."food_origin" AS ENUM('usda', 'openfoodfacts', 'community', 'personal');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."food_status" AS ENUM('active', 'pending', 'rejected', 'merged');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."food_tier" AS ENUM('authoritative', 'community', 'personal');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."goal" AS ENUM('lose', 'maintain', 'gain');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."log_source" AS ENUM('barcode', 'manual', 'search');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."meal" AS ENUM('breakfast', 'lunch', 'dinner', 'snack');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."mood" AS ENUM('great', 'good', 'ok', 'low', 'bad');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."nutrient_basis" AS ENUM('per_100g', 'per_100ml', 'per_serving');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."platform" AS ENUM('ios', 'android');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."sex" AS ENUM('male', 'female');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."sub_provider" AS ENUM('app_store', 'play_store', 'stripe');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."sub_status" AS ENUM('trialing', 'active', 'in_grace', 'past_due', 'canceled', 'expired');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."user_tier" AS ENUM('free', 'premium');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."webhook_provider" AS ENUM('revenuecat', 'stripe');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."webhook_status" AS ENUM('received', 'processed', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."weight_source" AS ENUM('manual', 'healthkit', 'googlefit');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" "citext" NOT NULL,
	"name" text NOT NULL,
	"goal" "goal",
	"sex" "sex",
	"age" integer,
	"height_cm" numeric(5, 1),
	"weight_kg" numeric(5, 1),
	"target_weight_kg" numeric(5, 1),
	"tdee_kcal" integer,
	"daily_target_kcal" integer,
	"target_protein_g" integer,
	"target_carbs_g" integer,
	"target_fat_g" integer,
	"notify_at" time,
	"timezone" text,
	"tier" "user_tier" DEFAULT 'free' NOT NULL,
	"subscription_status" text,
	"trial_ends_at" timestamp with time zone,
	"onboarding_step" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "food_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tier" "food_tier" NOT NULL,
	"status" "food_status" DEFAULT 'active' NOT NULL,
	"origin" "food_origin" NOT NULL,
	"origin_ref" text,
	"barcode" text,
	"name" text NOT NULL,
	"brand" text,
	"created_by" uuid,
	"owner_user_id" uuid,
	"merged_into_id" uuid,
	"verified_at" timestamp with time zone,
	"search_text" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(brand, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "food_nutrients" (
	"food_item_id" uuid PRIMARY KEY NOT NULL,
	"basis" "nutrient_basis" NOT NULL,
	"serving_label" text,
	"serving_g" numeric,
	"kcal" numeric NOT NULL,
	"protein_g" numeric NOT NULL,
	"carbs_g" numeric NOT NULL,
	"fat_g" numeric NOT NULL,
	"fiber_g" numeric,
	"sugar_g" numeric,
	"added_sugar_g" numeric,
	"sodium_mg" numeric,
	"sat_fat_g" numeric,
	"micros" jsonb,
	"nova_group" smallint,
	"data_completeness" numeric
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "food_servings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"food_item_id" uuid NOT NULL,
	"label" text NOT NULL,
	"grams" numeric NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "food_logs" (
	"id" uuid NOT NULL,
	"logged_at" timestamp with time zone NOT NULL,
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"meal" "meal" NOT NULL,
	"source" "log_source" NOT NULL,
	"barcode" text,
	"food_item_id" uuid,
	"serving_id" uuid,
	"name" text NOT NULL,
	"serving_qty" numeric NOT NULL,
	"serving_unit" text,
	"kcal" integer NOT NULL,
	"protein_g" numeric NOT NULL,
	"carbs_g" numeric NOT NULL,
	"fat_g" numeric NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_logs_id_logged_at_pk" PRIMARY KEY("id","logged_at")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "food_favorites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"food_item_id" uuid NOT NULL,
	"last_used_at" timestamp with time zone,
	"use_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "daily_summaries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"total_calories" integer DEFAULT 0 NOT NULL,
	"total_protein_g" numeric DEFAULT '0' NOT NULL,
	"total_carbs_g" numeric DEFAULT '0' NOT NULL,
	"total_fat_g" numeric DEFAULT '0' NOT NULL,
	"calorie_target" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "streaks" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"longest_streak" integer DEFAULT 0 NOT NULL,
	"last_logged_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "check_ins" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"mood" "mood" NOT NULL,
	"tip_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "weight_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"weight_kg" numeric(5, 1) NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"source" "weight_source" DEFAULT 'manual' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "water_intake" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"amount_ml" integer NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"rc_app_user_id" text,
	"provider" "sub_provider" NOT NULL,
	"product_id" text,
	"status" "sub_status" NOT NULL,
	"trial_end" timestamp with time zone,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"last_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_captures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" "citext" NOT NULL,
	"source" text,
	"reconciled_user_id" uuid,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_captures_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"to_email" "citext" NOT NULL,
	"template" text NOT NULL,
	"status" "email_status" DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expo_push_token" text NOT NULL,
	"platform" "platform" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" "webhook_provider" NOT NULL,
	"event_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"status" "webhook_status" DEFAULT 'received' NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_admin_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"before" jsonb,
	"after" jsonb,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "food_items" ADD CONSTRAINT "food_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "food_items" ADD CONSTRAINT "food_items_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "food_items" ADD CONSTRAINT "food_items_merged_into_id_food_items_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."food_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "food_nutrients" ADD CONSTRAINT "food_nutrients_food_item_id_food_items_id_fk" FOREIGN KEY ("food_item_id") REFERENCES "public"."food_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "food_servings" ADD CONSTRAINT "food_servings_food_item_id_food_items_id_fk" FOREIGN KEY ("food_item_id") REFERENCES "public"."food_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "food_logs" ADD CONSTRAINT "food_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "food_logs" ADD CONSTRAINT "food_logs_food_item_id_food_items_id_fk" FOREIGN KEY ("food_item_id") REFERENCES "public"."food_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "food_logs" ADD CONSTRAINT "food_logs_serving_id_food_servings_id_fk" FOREIGN KEY ("serving_id") REFERENCES "public"."food_servings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "food_favorites" ADD CONSTRAINT "food_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "food_favorites" ADD CONSTRAINT "food_favorites_food_item_id_food_items_id_fk" FOREIGN KEY ("food_item_id") REFERENCES "public"."food_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "daily_summaries" ADD CONSTRAINT "daily_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "streaks" ADD CONSTRAINT "streaks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "weight_entries" ADD CONSTRAINT "weight_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "water_intake" ADD CONSTRAINT "water_intake_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_captures" ADD CONSTRAINT "email_captures_reconciled_user_id_users_id_fk" FOREIGN KEY ("reconciled_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_items_barcode_active_uniq" ON "food_items" USING btree ("barcode") WHERE "food_items"."status" = 'active';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_items_tier_status_idx" ON "food_items" USING btree ("tier","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_items_owner_personal_idx" ON "food_items" USING btree ("owner_user_id") WHERE "food_items"."tier" = 'personal';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_items_search_text_idx" ON "food_items" USING gin ("search_text");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_logs_user_local_date_idx" ON "food_logs" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_logs_user_logged_at_idx" ON "food_logs" USING btree ("user_id","logged_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_favorites_user_item_uniq" ON "food_favorites" USING btree ("user_id","food_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "daily_summaries_user_date_uniq" ON "daily_summaries" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "check_ins_user_date_uniq" ON "check_ins" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "weight_entries_user_recorded_at_idx" ON "weight_entries" USING btree ("user_id","recorded_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "water_intake_user_local_date_idx" ON "water_intake" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_status_idx" ON "subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_period_end_idx" ON "subscriptions" USING btree ("current_period_end");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_logs_user_idx" ON "email_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_logs_status_created_idx" ON "email_logs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "push_tokens_token_uniq" ON "push_tokens" USING btree ("expo_push_token");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_events_provider_event_uniq" ON "webhook_events" USING btree ("provider","event_id");