ALTER TABLE "users" ALTER COLUMN "account_status" SET DEFAULT 'free_plan';
UPDATE "users" SET "account_status" = 'free_plan' WHERE "account_status" = 'dormant';