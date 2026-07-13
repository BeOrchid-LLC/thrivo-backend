CREATE TABLE "mrr_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"snapshot_date" date NOT NULL,
	"mrr_cents" integer NOT NULL,
	"active_monthly_count" integer NOT NULL,
	"active_annual_count" integer NOT NULL,
	"premium_user_count" integer NOT NULL,
	"free_user_count" integer NOT NULL,
	"churned_mrr_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mrr_snapshots_snapshot_date_uniq" ON "mrr_snapshots" USING btree ("snapshot_date");