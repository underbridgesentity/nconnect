ALTER TABLE "provisioning_tasks" ALTER COLUMN "service_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "provisioning_tasks" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "provisioning_tasks" ADD CONSTRAINT "provisioning_tasks_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;