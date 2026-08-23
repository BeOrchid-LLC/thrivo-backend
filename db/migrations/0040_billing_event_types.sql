ALTER TYPE "public"."subscription_event_type" ADD VALUE IF NOT EXISTS 'canceled';--> statement-breakpoint
ALTER TYPE "public"."subscription_event_type" ADD VALUE IF NOT EXISTS 'billing_issue';--> statement-breakpoint
ALTER TYPE "public"."subscription_event_type" ADD VALUE IF NOT EXISTS 'refunded';--> statement-breakpoint
ALTER TYPE "public"."subscription_event_type" ADD VALUE IF NOT EXISTS 'refund_reversed';--> statement-breakpoint
ALTER TYPE "public"."subscription_event_type" ADD VALUE IF NOT EXISTS 'product_changed';--> statement-breakpoint
ALTER TYPE "public"."subscription_event_type" ADD VALUE IF NOT EXISTS 'subscription_extended';
