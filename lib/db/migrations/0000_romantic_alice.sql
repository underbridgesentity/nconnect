CREATE TYPE "public"."bundle_item_type" AS ENUM('plan', 'hardware', 'custom');--> statement-breakpoint
CREATE TYPE "public"."catalogue_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."collection_result" AS ENUM('success', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."consent_kind" AS ENUM('popia_processing', 'marketing_whatsapp', 'marketing_email');--> statement-breakpoint
CREATE TYPE "public"."conversation_channel" AS ENUM('portal', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."conversation_priority" AS ENUM('normal', 'high');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('open', 'pending', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."customer_source" AS ENUM('web', 'sales', 'import', 'admin');--> statement-breakpoint
CREATE TYPE "public"."customer_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."customer_type" AS ENUM('individual', 'business');--> statement-breakpoint
CREATE TYPE "public"."hardware_category" AS ENUM('router_lte', 'router_5g', 'router_fibre', 'mesh', 'extender', 'voip_phone', 'power', 'accessory');--> statement-breakpoint
CREATE TYPE "public"."invoice_line_kind" AS ENUM('subscription', 'once_off', 'hardware', 'prorata_charge', 'prorata_credit', 'adjustment', 'reactivation');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'open', 'paid', 'past_due', 'void', 'written_off');--> statement-breakpoint
CREATE TYPE "public"."lead_activity_kind" AS ENUM('note', 'call', 'whatsapp', 'status_change');--> statement-breakpoint
CREATE TYPE "public"."lead_source" AS ENUM('web_coverage', 'web_abandoned', 'manual', 'referral');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'quoted', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound', 'internal_note');--> statement-breakpoint
CREATE TYPE "public"."order_channel" AS ENUM('web', 'sales', 'admin');--> statement-breakpoint
CREATE TYPE "public"."order_item_type" AS ENUM('plan', 'hardware', 'bundle', 'custom');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending_payment', 'paid', 'processing', 'fulfilled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payment_method_kind" AS ENUM('payfast_card', 'payfast_token', 'eft_manual');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('initiated', 'complete', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."plan_category" AS ENUM('lte_home', 'telkom_lte', 'fibre', 'voip', 'sim_data');--> statement-breakpoint
CREATE TYPE "public"."provider_kind" AS ENUM('mno', 'fno', 'voip');--> statement-breakpoint
CREATE TYPE "public"."provisioning_task_status" AS ENUM('open', 'in_progress', 'blocked', 'done');--> statement-breakpoint
CREATE TYPE "public"."provisioning_task_type" AS ENUM('activate', 'suspend', 'reactivate', 'cancel', 'change_plan', 'feasibility_check');--> statement-breakpoint
CREATE TYPE "public"."quote_item_type" AS ENUM('plan', 'hardware', 'bundle', 'custom');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('draft', 'sent', 'viewed', 'accepted', 'expired');--> statement-breakpoint
CREATE TYPE "public"."rica_status" AS ENUM('pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."service_status" AS ENUM('pending', 'provisioning', 'active', 'suspended', 'pending_cancellation', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."sim_network" AS ENUM('mtn', 'vodacom', 'telkom');--> statement-breakpoint
CREATE TYPE "public"."sim_status" AS ENUM('in_stock', 'allocated', 'active', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."stored_payment_method_status" AS ENUM('active', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'sales', 'customer');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('invited', 'active', 'disabled');--> statement-breakpoint
CREATE TABLE "addresses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"label" text,
	"line1" text NOT NULL,
	"line2" text,
	"suburb" text,
	"city" text NOT NULL,
	"province" text,
	"postal_code" text,
	"place_id" text,
	"lat" double precision,
	"lng" double precision,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"actor_role" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bundle_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bundle_id" uuid NOT NULL,
	"item_type" "bundle_item_type" NOT NULL,
	"plan_id" uuid,
	"hardware_id" uuid,
	"custom_name" text,
	"custom_price_cents" integer,
	"qty" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bundles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"price_cents" integer NOT NULL,
	"status" "catalogue_status" DEFAULT 'draft' NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"valid_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoice_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"executed_at" timestamp with time zone,
	"result" "collection_result",
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" "consent_kind" NOT NULL,
	"granted" boolean NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid,
	"channel" "conversation_channel" NOT NULL,
	"subject" text,
	"status" "conversation_status" DEFAULT 'open' NOT NULL,
	"assigned_to" uuid,
	"priority" "conversation_priority" DEFAULT 'normal' NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"type" "customer_type" DEFAULT 'individual' NOT NULL,
	"first_name" text,
	"last_name" text,
	"company_name" text,
	"company_reg" text,
	"vat_number" text,
	"email" text,
	"phone" text,
	"id_number_encrypted" text,
	"source" "customer_source" DEFAULT 'web' NOT NULL,
	"assigned_sales_id" uuid,
	"status" "customer_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"forwarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hardware_products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"category" "hardware_category" NOT NULL,
	"description" text,
	"specs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"price_cents" integer NOT NULL,
	"cost_cents" integer,
	"stock_qty" integer DEFAULT 0 NOT NULL,
	"low_stock_threshold" integer DEFAULT 3 NOT NULL,
	"status" "catalogue_status" DEFAULT 'draft' NOT NULL,
	"image_path" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoice_id" uuid NOT NULL,
	"kind" "invoice_line_kind" NOT NULL,
	"description" text NOT NULL,
	"service_id" uuid,
	"amount_cents" integer NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"service_id" uuid,
	"order_id" uuid,
	"period_start" date,
	"period_end" date,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_activities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"kind" "lead_activity_kind" NOT NULL,
	"body" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"source" "lead_source" DEFAULT 'manual' NOT NULL,
	"interest" text,
	"address_text" text,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"owner_sales_id" uuid,
	"lost_reason" text,
	"converted_customer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" "message_direction" NOT NULL,
	"author_user_id" uuid,
	"body" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_id" text,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "number_sequences" (
	"prefix" text NOT NULL,
	"year" integer NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "number_sequences_prefix_year_pk" PRIMARY KEY("prefix","year")
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"item_type" "order_item_type" NOT NULL,
	"plan_id" uuid,
	"hardware_id" uuid,
	"bundle_id" uuid,
	"name_snapshot" text NOT NULL,
	"unit_price_cents_snapshot" integer NOT NULL,
	"unit_cost_cents_snapshot" integer,
	"qty" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"channel" "order_channel" DEFAULT 'web' NOT NULL,
	"quote_id" uuid,
	"status" "order_status" DEFAULT 'pending_payment' NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"payfast_ref" text,
	"paid_at" timestamp with time zone,
	"created_by" uuid,
	"address_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"payfast_token" text NOT NULL,
	"card_last4" text,
	"card_brand" text,
	"status" "stored_payment_method_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoice_id" uuid NOT NULL,
	"method" "payment_method_kind" NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" "payment_status" DEFAULT 'initiated' NOT NULL,
	"gateway_ref" text,
	"failure_reason" text,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_id" uuid NOT NULL,
	"category" "plan_category" NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"speed_down_mbps" integer,
	"speed_up_mbps" integer,
	"data_allocation" text,
	"fup_detail" text,
	"contract_months" integer,
	"price_cents" integer NOT NULL,
	"cost_cents" integer,
	"once_off_cents" integer DEFAULT 0 NOT NULL,
	"once_off_cost_cents" integer,
	"status" "catalogue_status" DEFAULT 'draft' NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"service_id" uuid,
	"external_ref" text NOT NULL,
	"msisdn" text,
	"circuit_id" text,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "provider_kind" NOT NULL,
	"portal_url" text,
	"account_manager_name" text,
	"account_manager_contact" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provisioning_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"service_id" uuid NOT NULL,
	"type" "provisioning_task_type" NOT NULL,
	"status" "provisioning_task_status" DEFAULT 'open' NOT NULL,
	"assigned_to" uuid,
	"due_at" timestamp with time zone,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result_notes" text,
	"completed_by" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quote_id" uuid NOT NULL,
	"item_type" "quote_item_type" NOT NULL,
	"plan_id" uuid,
	"hardware_id" uuid,
	"bundle_id" uuid,
	"name_snapshot" text NOT NULL,
	"unit_price_cents_snapshot" integer NOT NULL,
	"unit_cost_cents_snapshot" integer,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"lead_id" uuid,
	"customer_id" uuid,
	"created_by" uuid NOT NULL,
	"status" "quote_status" DEFAULT 'draft' NOT NULL,
	"share_token" text NOT NULL,
	"expires_at" timestamp with time zone,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"first_viewed_at" timestamp with time zone,
	"accepted_order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rica_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"sim_id" uuid,
	"id_number_encrypted" text NOT NULL,
	"id_doc_path" text,
	"poa_doc_path" text,
	"status" "rica_status" DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"origin_order_id" uuid,
	"address_id" uuid,
	"status" "service_status" DEFAULT 'pending' NOT NULL,
	"activation_date" date,
	"billing_anchor_day" integer,
	"next_invoice_date" date,
	"provider_account_id" uuid,
	"sim_id" uuid,
	"cancel_reason" text,
	"cancel_effective_date" date,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signup_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"draft_key" text NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"iccid" text NOT NULL,
	"msisdn" text,
	"network" "sim_network" NOT NULL,
	"status" "sim_status" DEFAULT 'in_stock' NOT NULL,
	"service_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"role" "user_role" NOT NULL,
	"phone" text,
	"email" text,
	"password_hash" text,
	"name" text NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundle_items" ADD CONSTRAINT "bundle_items_bundle_id_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."bundles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundle_items" ADD CONSTRAINT "bundle_items_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundle_items" ADD CONSTRAINT "bundle_items_hardware_id_hardware_products_id_fk" FOREIGN KEY ("hardware_id") REFERENCES "public"."hardware_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_attempts" ADD CONSTRAINT "collection_attempts_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_assigned_sales_id_users_id_fk" FOREIGN KEY ("assigned_sales_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_tokens" ADD CONSTRAINT "invite_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_sales_id_users_id_fk" FOREIGN KEY ("owner_sales_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_customer_id_customers_id_fk" FOREIGN KEY ("converted_customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_hardware_id_hardware_products_id_fk" FOREIGN KEY ("hardware_id") REFERENCES "public"."hardware_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_bundle_id_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."bundles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_address_id_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD CONSTRAINT "provider_accounts_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD CONSTRAINT "provider_accounts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD CONSTRAINT "provider_accounts_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_tasks" ADD CONSTRAINT "provisioning_tasks_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_tasks" ADD CONSTRAINT "provisioning_tasks_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_tasks" ADD CONSTRAINT "provisioning_tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_hardware_id_hardware_products_id_fk" FOREIGN KEY ("hardware_id") REFERENCES "public"."hardware_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_bundle_id_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."bundles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_accepted_order_id_orders_id_fk" FOREIGN KEY ("accepted_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rica_records" ADD CONSTRAINT "rica_records_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rica_records" ADD CONSTRAINT "rica_records_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rica_records" ADD CONSTRAINT "rica_records_sim_id_sims_id_fk" FOREIGN KEY ("sim_id") REFERENCES "public"."sims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rica_records" ADD CONSTRAINT "rica_records_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_origin_order_id_orders_id_fk" FOREIGN KEY ("origin_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_address_id_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sims" ADD CONSTRAINT "sims_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "addresses_customer_id_idx" ON "addresses" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "bundle_items_bundle_id_idx" ON "bundle_items" USING btree ("bundle_id");--> statement-breakpoint
CREATE INDEX "bundle_items_plan_id_idx" ON "bundle_items" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "bundle_items_hardware_id_idx" ON "bundle_items" USING btree ("hardware_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bundles_slug_unique" ON "bundles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "collection_attempts_invoice_id_idx" ON "collection_attempts" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "collection_attempts_scheduled_for_idx" ON "collection_attempts" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "consents_customer_id_idx" ON "consents" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "conversations_customer_id_idx" ON "conversations" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "conversations_status_idx" ON "conversations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "conversations_assigned_to_idx" ON "conversations" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "conversations_last_message_at_idx" ON "conversations" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "customers_user_id_idx" ON "customers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "customers_assigned_sales_id_idx" ON "customers" USING btree ("assigned_sales_id");--> statement-breakpoint
CREATE INDEX "customers_phone_idx" ON "customers" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "customers_status_idx" ON "customers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "domain_events_forwarded_at_idx" ON "domain_events" USING btree ("forwarded_at");--> statement-breakpoint
CREATE INDEX "domain_events_name_idx" ON "domain_events" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "hardware_sku_unique" ON "hardware_products" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "hardware_category_status_idx" ON "hardware_products" USING btree ("category","status");--> statement-breakpoint
CREATE INDEX "invite_tokens_user_id_idx" ON "invite_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_id_idx" ON "invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_service_id_idx" ON "invoice_lines" USING btree ("service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_unique" ON "invoices" USING btree ("number");--> statement-breakpoint
CREATE INDEX "invoices_customer_id_idx" ON "invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "invoices_service_id_idx" ON "invoices" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "invoices_order_id_idx" ON "invoices" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoices_due_date_idx" ON "invoices" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "lead_activities_lead_id_idx" ON "lead_activities" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leads_owner_sales_id_idx" ON "leads" USING btree ("owner_sales_id");--> statement-breakpoint
CREATE INDEX "leads_converted_customer_id_idx" ON "leads" USING btree ("converted_customer_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_id_idx" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_external_id_unique" ON "messages" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "notifications_user_id_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_read_at_idx" ON "notifications" USING btree ("read_at");--> statement-breakpoint
CREATE INDEX "order_items_order_id_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_plan_id_idx" ON "order_items" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "order_items_hardware_id_idx" ON "order_items" USING btree ("hardware_id");--> statement-breakpoint
CREATE INDEX "order_items_bundle_id_idx" ON "order_items" USING btree ("bundle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_number_unique" ON "orders" USING btree ("number");--> statement-breakpoint
CREATE INDEX "orders_customer_id_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_quote_id_idx" ON "orders" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "otp_codes_phone_idx" ON "otp_codes" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "otp_codes_expires_at_idx" ON "otp_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "payment_methods_customer_id_idx" ON "payment_methods" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "payments_invoice_id_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_gateway_ref_unique" ON "payments" USING btree ("gateway_ref");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_slug_unique" ON "plans" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "plans_provider_id_idx" ON "plans" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "plans_category_status_idx" ON "plans" USING btree ("category","status");--> statement-breakpoint
CREATE INDEX "provider_accounts_provider_id_idx" ON "provider_accounts" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "provider_accounts_customer_id_idx" ON "provider_accounts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "provider_accounts_service_id_idx" ON "provider_accounts" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "provisioning_tasks_service_id_idx" ON "provisioning_tasks" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "provisioning_tasks_status_idx" ON "provisioning_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "provisioning_tasks_assigned_to_idx" ON "provisioning_tasks" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "provisioning_tasks_due_at_idx" ON "provisioning_tasks" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "quote_items_quote_id_idx" ON "quote_items" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "quote_items_plan_id_idx" ON "quote_items" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "quote_items_hardware_id_idx" ON "quote_items" USING btree ("hardware_id");--> statement-breakpoint
CREATE INDEX "quote_items_bundle_id_idx" ON "quote_items" USING btree ("bundle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_number_unique" ON "quotes" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_share_token_unique" ON "quotes" USING btree ("share_token");--> statement-breakpoint
CREATE INDEX "quotes_lead_id_idx" ON "quotes" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "quotes_customer_id_idx" ON "quotes" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "quotes_created_by_idx" ON "quotes" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "quotes_status_idx" ON "quotes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "rica_records_customer_id_idx" ON "rica_records" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "rica_records_service_id_idx" ON "rica_records" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "rica_records_status_idx" ON "rica_records" USING btree ("status");--> statement-breakpoint
CREATE INDEX "services_customer_id_idx" ON "services" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "services_plan_id_idx" ON "services" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "services_status_idx" ON "services" USING btree ("status");--> statement-breakpoint
CREATE INDEX "services_next_invoice_date_idx" ON "services" USING btree ("next_invoice_date");--> statement-breakpoint
CREATE INDEX "services_cancel_effective_date_idx" ON "services" USING btree ("cancel_effective_date");--> statement-breakpoint
CREATE INDEX "services_origin_order_id_idx" ON "services" USING btree ("origin_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signup_drafts_key_unique" ON "signup_drafts" USING btree ("draft_key");--> statement-breakpoint
CREATE UNIQUE INDEX "sims_iccid_unique" ON "sims" USING btree ("iccid");--> statement-breakpoint
CREATE INDEX "sims_status_idx" ON "sims" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sims_service_id_idx" ON "sims" USING btree ("service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_unique" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");