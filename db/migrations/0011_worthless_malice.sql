ALTER TABLE "food_logs" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "water_intake" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "food_logs_user_idempotency_uniq" ON "food_logs" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "water_intake_user_idempotency_uniq" ON "water_intake" USING btree ("user_id","idempotency_key");
