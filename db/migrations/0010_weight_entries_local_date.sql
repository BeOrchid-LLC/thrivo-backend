ALTER TABLE "weight_entries" ADD COLUMN "local_date" date;
UPDATE "weight_entries" SET "local_date" = ("recorded_at" AT TIME ZONE 'UTC')::date WHERE "local_date" IS NULL;
ALTER TABLE "weight_entries" ALTER COLUMN "local_date" SET NOT NULL;
CREATE INDEX "weight_entries_user_local_date_idx" ON "weight_entries" USING btree ("user_id","local_date");
