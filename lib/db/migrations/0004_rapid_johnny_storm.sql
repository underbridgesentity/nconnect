ALTER TABLE "services" ADD COLUMN "pending_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "plan_change_effective_date" date;