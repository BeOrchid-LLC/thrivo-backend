ALTER TABLE "food_logs" ADD COLUMN "consumed_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "food_logs" SET "consumed_at" = "logged_at" WHERE "consumed_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "food_logs" ALTER COLUMN "consumed_at" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "food_logs" DROP COLUMN "meal";
--> statement-breakpoint
CREATE INDEX "food_logs_user_consumed_at_idx" ON "food_logs" USING btree ("user_id","consumed_at");
