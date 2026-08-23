CREATE UNIQUE INDEX IF NOT EXISTS "subscription_events_raw_event_uniq"
  ON "subscription_events" ("raw_event_id") WHERE "raw_event_id" IS NOT NULL;
