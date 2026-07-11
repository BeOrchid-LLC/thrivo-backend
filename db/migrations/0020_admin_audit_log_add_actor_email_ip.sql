ALTER TABLE "admin_audit_log" ADD COLUMN "actor_admin_email" text NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD COLUMN "ip" text;