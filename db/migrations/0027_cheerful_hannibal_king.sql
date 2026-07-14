DROP INDEX CONCURRENTLY IF EXISTS "email_logs_user_idx";--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "users_weekly_review_eligibility_idx";--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "email_logs_user_template_created_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY "users_weekly_review_eligibility_idx" ON "users" USING btree ("timezone","id") WHERE "users"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX CONCURRENTLY "email_logs_user_template_created_idx" ON "email_logs" USING btree ("user_id","template","created_at");