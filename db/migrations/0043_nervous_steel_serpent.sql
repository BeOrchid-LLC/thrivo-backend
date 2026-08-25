ALTER TABLE "push_tokens" ADD COLUMN "device_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "push_tokens_user_device_uniq" ON "push_tokens" USING btree ("user_id","device_id");