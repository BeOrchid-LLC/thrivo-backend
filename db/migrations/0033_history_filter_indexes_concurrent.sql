CREATE INDEX CONCURRENTLY IF NOT EXISTS "food_logs_user_date_consumed_id_idx" ON "food_logs" USING btree ("user_id","local_date","consumed_at","id");--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "food_logs_user_kcal_id_idx" ON "food_logs" USING btree ("user_id","kcal","id");--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "food_logs_name_trgm_idx" ON "food_logs" USING gin (lower("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "water_intake_user_date_recorded_id_idx" ON "water_intake" USING btree ("user_id","local_date","recorded_at","id");--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "water_intake_user_amount_id_idx" ON "water_intake" USING btree ("user_id","amount_ml","id");
