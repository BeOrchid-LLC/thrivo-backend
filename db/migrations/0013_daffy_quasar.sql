CREATE TABLE "tips" (
	"id" uuid PRIMARY KEY NOT NULL,
	"body" text NOT NULL,
	"mood" "mood",
	"is_active" boolean DEFAULT true NOT NULL,
	"pinned_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "tips_active_idx" ON "tips" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "tips_pinned_date_idx" ON "tips" USING btree ("pinned_date");