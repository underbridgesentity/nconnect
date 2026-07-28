import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  date,
  jsonb,
  doublePrecision,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

/**
 * Conventions (spec §4): uuid v7 ids, created_at/updated_at everywhere,
 * integer cents for money, Postgres enums, no destructive deletes on
 * financial or lifecycle records, indexes on FKs and queue-filter columns.
 */

const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRole = pgEnum("user_role", ["admin", "sales", "customer"]);
export const userStatus = pgEnum("user_status", [
  "invited",
  "active",
  "disabled",
]);
export const customerType = pgEnum("customer_type", ["individual", "business"]);
export const customerSource = pgEnum("customer_source", [
  "web",
  "sales",
  "import",
  "admin",
]);
export const customerStatus = pgEnum("customer_status", ["active", "archived"]);
export const consentKind = pgEnum("consent_kind", [
  "popia_processing",
  "marketing_whatsapp",
  "marketing_email",
]);
export const providerKind = pgEnum("provider_kind", ["mno", "fno", "voip"]);
export const planCategory = pgEnum("plan_category", [
  "lte_home",
  "telkom_lte",
  "fibre",
  "voip",
  "sim_data",
]);
export const catalogueStatus = pgEnum("catalogue_status", [
  "draft",
  "published",
  "archived",
]);
export const hardwareCategory = pgEnum("hardware_category", [
  "router_lte",
  "router_5g",
  "router_fibre",
  "mesh",
  "extender",
  "voip_phone",
  "power",
  "accessory",
]);
export const bundleItemType = pgEnum("bundle_item_type", [
  "plan",
  "hardware",
  "custom",
]);
export const orderChannel = pgEnum("order_channel", ["web", "sales", "admin"]);
export const orderStatus = pgEnum("order_status", [
  "pending_payment",
  "paid",
  "processing",
  "fulfilled",
  "cancelled",
]);
export const orderItemType = pgEnum("order_item_type", [
  "plan",
  "hardware",
  "bundle",
  "custom",
]);
export const serviceStatus = pgEnum("service_status", [
  "pending",
  "provisioning",
  "active",
  "suspended",
  "pending_cancellation",
  "cancelled",
]);
export const simNetwork = pgEnum("sim_network", ["mtn", "vodacom", "telkom"]);
export const simStatus = pgEnum("sim_status", [
  "in_stock",
  "allocated",
  "active",
  "deactivated",
]);
export const provisioningTaskType = pgEnum("provisioning_task_type", [
  "activate",
  "suspend",
  "reactivate",
  "cancel",
  "change_plan",
  "feasibility_check",
]);
export const provisioningTaskStatus = pgEnum("provisioning_task_status", [
  "open",
  "in_progress",
  "blocked",
  "done",
]);
export const invoiceStatus = pgEnum("invoice_status", [
  "draft",
  "open",
  "paid",
  "past_due",
  "void",
  "written_off",
]);
export const invoiceLineKind = pgEnum("invoice_line_kind", [
  "subscription",
  "once_off",
  "hardware",
  "prorata_charge",
  "prorata_credit",
  "adjustment",
  "reactivation",
]);
export const paymentMethodKind = pgEnum("payment_method_kind", [
  "payfast_card",
  "payfast_token",
  "eft_manual",
]);
export const paymentStatus = pgEnum("payment_status", [
  "initiated",
  "complete",
  "failed",
  "refunded",
]);
export const storedPaymentMethodStatus = pgEnum("stored_payment_method_status", [
  "active",
  "expired",
  "revoked",
]);
export const collectionResult = pgEnum("collection_result", [
  "success",
  "failed",
  "skipped",
]);
export const conversationChannel = pgEnum("conversation_channel", [
  "portal",
  "whatsapp",
]);
export const conversationStatus = pgEnum("conversation_status", [
  "open",
  "pending",
  "resolved",
]);
export const conversationPriority = pgEnum("conversation_priority", [
  "normal",
  "high",
]);
export const messageDirection = pgEnum("message_direction", [
  "inbound",
  "outbound",
  "internal_note",
]);
export const leadSource = pgEnum("lead_source", [
  "web_coverage",
  "web_abandoned",
  "manual",
  "referral",
]);
export const leadStatus = pgEnum("lead_status", [
  "new",
  "contacted",
  "quoted",
  "won",
  "lost",
]);
export const leadActivityKind = pgEnum("lead_activity_kind", [
  "note",
  "call",
  "whatsapp",
  "status_change",
]);
export const quoteStatus = pgEnum("quote_status", [
  "draft",
  "sent",
  "viewed",
  "accepted",
  "expired",
]);
export const quoteItemType = pgEnum("quote_item_type", [
  "plan",
  "hardware",
  "bundle",
  "custom",
]);
export const ricaStatus = pgEnum("rica_status", [
  "pending",
  "verified",
  "rejected",
]);

// ---------------------------------------------------------------------------
// §4.1 Identity and CRM
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: id(),
    role: userRole("role").notNull(),
    phone: text("phone"), // E.164; nullable for staff
    email: text("email"), // nullable for customers
    passwordHash: text("password_hash"), // staff only
    name: text("name").notNull(),
    status: userStatus("status").notNull().default("active"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("users_phone_unique").on(t.phone),
    uniqueIndex("users_email_unique").on(t.email),
    index("users_role_idx").on(t.role),
  ]
);

export const customers = pgTable(
  "customers",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id),
    type: customerType("type").notNull().default("individual"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    companyName: text("company_name"),
    companyReg: text("company_reg"),
    vatNumber: text("vat_number"),
    email: text("email"),
    phone: text("phone"),
    idNumberEncrypted: text("id_number_encrypted"),
    source: customerSource("source").notNull().default("web"),
    assignedSalesId: uuid("assigned_sales_id").references(() => users.id),
    status: customerStatus("status").notNull().default("active"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    index("customers_user_id_idx").on(t.userId),
    index("customers_assigned_sales_id_idx").on(t.assignedSalesId),
    index("customers_phone_idx").on(t.phone),
    index("customers_status_idx").on(t.status),
  ]
);

export const addresses = pgTable(
  "addresses",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    label: text("label"),
    line1: text("line1").notNull(),
    line2: text("line2"),
    suburb: text("suburb"),
    city: text("city").notNull(),
    province: text("province"),
    postalCode: text("postal_code"),
    placeId: text("place_id"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    isPrimary: boolean("is_primary").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("addresses_customer_id_idx").on(t.customerId)]
);

export const consents = pgTable(
  "consents",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    kind: consentKind("kind").notNull(),
    granted: boolean("granted").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    ...timestamps,
  },
  (t) => [index("consents_customer_id_idx").on(t.customerId)]
);

// ---------------------------------------------------------------------------
// §4.2 Catalogue
// ---------------------------------------------------------------------------

export const providers = pgTable("providers", {
  id: id(),
  name: text("name").notNull(),
  kind: providerKind("kind").notNull(),
  portalUrl: text("portal_url"),
  accountManagerName: text("account_manager_name"),
  accountManagerContact: text("account_manager_contact"),
  notes: text("notes"),
  ...timestamps,
});

export const plans = pgTable(
  "plans",
  {
    id: id(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => providers.id),
    category: planCategory("category").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    speedDownMbps: integer("speed_down_mbps"),
    speedUpMbps: integer("speed_up_mbps"),
    dataAllocation: text("data_allocation"),
    fupDetail: text("fup_detail"),
    contractMonths: integer("contract_months"),
    priceCents: integer("price_cents").notNull(),
    costCents: integer("cost_cents"),
    onceOffCents: integer("once_off_cents").notNull().default(0),
    onceOffCostCents: integer("once_off_cost_cents"),
    status: catalogueStatus("status").notNull().default("draft"),
    featured: boolean("featured").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("plans_slug_unique").on(t.slug),
    index("plans_provider_id_idx").on(t.providerId),
    index("plans_category_status_idx").on(t.category, t.status),
  ]
);

export const hardwareProducts = pgTable(
  "hardware_products",
  {
    id: id(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    category: hardwareCategory("category").notNull(),
    description: text("description"),
    specs: jsonb("specs")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    priceCents: integer("price_cents").notNull(),
    costCents: integer("cost_cents"),
    stockQty: integer("stock_qty").notNull().default(0),
    lowStockThreshold: integer("low_stock_threshold").notNull().default(3),
    status: catalogueStatus("status").notNull().default("draft"),
    imagePath: text("image_path"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("hardware_sku_unique").on(t.sku),
    index("hardware_category_status_idx").on(t.category, t.status),
  ]
);

export const bundles = pgTable(
  "bundles",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    priceCents: integer("price_cents").notNull(),
    status: catalogueStatus("status").notNull().default("draft"),
    featured: boolean("featured").notNull().default(false),
    validUntil: date("valid_until"),
    ...timestamps,
  },
  (t) => [uniqueIndex("bundles_slug_unique").on(t.slug)]
);

export const bundleItems = pgTable(
  "bundle_items",
  {
    id: id(),
    bundleId: uuid("bundle_id")
      .notNull()
      .references(() => bundles.id),
    itemType: bundleItemType("item_type").notNull(),
    planId: uuid("plan_id").references(() => plans.id),
    hardwareId: uuid("hardware_id").references(() => hardwareProducts.id),
    customName: text("custom_name"),
    customPriceCents: integer("custom_price_cents"),
    qty: integer("qty").notNull().default(1),
    ...timestamps,
  },
  (t) => [
    index("bundle_items_bundle_id_idx").on(t.bundleId),
    index("bundle_items_plan_id_idx").on(t.planId),
    index("bundle_items_hardware_id_idx").on(t.hardwareId),
  ]
);

// ---------------------------------------------------------------------------
// §4.3 Orders and services
// ---------------------------------------------------------------------------

export const orders = pgTable(
  "orders",
  {
    id: id(),
    number: text("number").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    channel: orderChannel("channel").notNull().default("web"),
    quoteId: uuid("quote_id"), // FK added via relations; quotes defined below
    status: orderStatus("status").notNull().default("pending_payment"),
    subtotalCents: integer("subtotal_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    payfastRef: text("payfast_ref"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    addressId: uuid("address_id").references(() => addresses.id),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("orders_number_unique").on(t.number),
    index("orders_customer_id_idx").on(t.customerId),
    index("orders_status_idx").on(t.status),
    index("orders_quote_id_idx").on(t.quoteId),
  ]
);

export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    itemType: orderItemType("item_type").notNull(),
    planId: uuid("plan_id").references(() => plans.id),
    hardwareId: uuid("hardware_id").references(() => hardwareProducts.id),
    bundleId: uuid("bundle_id").references(() => bundles.id),
    nameSnapshot: text("name_snapshot").notNull(),
    unitPriceCentsSnapshot: integer("unit_price_cents_snapshot").notNull(),
    unitCostCentsSnapshot: integer("unit_cost_cents_snapshot"),
    qty: integer("qty").notNull().default(1),
    ...timestamps,
  },
  (t) => [
    index("order_items_order_id_idx").on(t.orderId),
    index("order_items_plan_id_idx").on(t.planId),
    index("order_items_hardware_id_idx").on(t.hardwareId),
    index("order_items_bundle_id_idx").on(t.bundleId),
  ]
);

export const services = pgTable(
  "services",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    originOrderId: uuid("origin_order_id").references(() => orders.id),
    addressId: uuid("address_id").references(() => addresses.id),
    status: serviceStatus("status").notNull().default("pending"),
    activationDate: date("activation_date"),
    billingAnchorDay: integer("billing_anchor_day"), // 1..28
    nextInvoiceDate: date("next_invoice_date"),
    providerAccountId: uuid("provider_account_id"),
    simId: uuid("sim_id"),
    cancelReason: text("cancel_reason"),
    cancelEffectiveDate: date("cancel_effective_date"),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    // Scheduled downgrade (spec §5): swaps at the next billing anchor.
    pendingPlanId: uuid("pending_plan_id"),
    planChangeEffectiveDate: date("plan_change_effective_date"),
    ...timestamps,
  },
  (t) => [
    index("services_customer_id_idx").on(t.customerId),
    index("services_plan_id_idx").on(t.planId),
    index("services_status_idx").on(t.status),
    index("services_next_invoice_date_idx").on(t.nextInvoiceDate),
    index("services_cancel_effective_date_idx").on(t.cancelEffectiveDate),
    index("services_origin_order_id_idx").on(t.originOrderId),
  ]
);

export const providerAccounts = pgTable(
  "provider_accounts",
  {
    id: id(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => providers.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    serviceId: uuid("service_id").references(() => services.id),
    externalRef: text("external_ref").notNull(),
    msisdn: text("msisdn"),
    circuitId: text("circuit_id"),
    notes: text("notes"),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    index("provider_accounts_provider_id_idx").on(t.providerId),
    index("provider_accounts_customer_id_idx").on(t.customerId),
    index("provider_accounts_service_id_idx").on(t.serviceId),
  ]
);

export const sims = pgTable(
  "sims",
  {
    id: id(),
    iccid: text("iccid").notNull(),
    msisdn: text("msisdn"),
    network: simNetwork("network").notNull(),
    status: simStatus("status").notNull().default("in_stock"),
    serviceId: uuid("service_id").references(() => services.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("sims_iccid_unique").on(t.iccid),
    index("sims_status_idx").on(t.status),
    index("sims_service_id_idx").on(t.serviceId),
  ]
);

export type ChecklistItem = { label: string; done: boolean };

export const provisioningTasks = pgTable(
  "provisioning_tasks",
  {
    id: id(),
    // Nullable: feasibility_check tasks precede any service; they carry a
    // lead instead (spec §7 fibre flow).
    serviceId: uuid("service_id").references(() => services.id),
    leadId: uuid("lead_id").references(() => leads.id),
    type: provisioningTaskType("type").notNull(),
    status: provisioningTaskStatus("status").notNull().default("open"),
    assignedTo: uuid("assigned_to").references(() => users.id),
    dueAt: timestamp("due_at", { withTimezone: true }),
    checklist: jsonb("checklist").$type<ChecklistItem[]>().notNull().default([]),
    resultNotes: text("result_notes"),
    completedBy: uuid("completed_by").references(() => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("provisioning_tasks_service_id_idx").on(t.serviceId),
    index("provisioning_tasks_status_idx").on(t.status),
    index("provisioning_tasks_assigned_to_idx").on(t.assignedTo),
    index("provisioning_tasks_due_at_idx").on(t.dueAt),
  ]
);

// ---------------------------------------------------------------------------
// §4.4 Billing
// ---------------------------------------------------------------------------

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    number: text("number").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    serviceId: uuid("service_id").references(() => services.id),
    orderId: uuid("order_id").references(() => orders.id),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date").notNull(),
    status: invoiceStatus("status").notNull().default("draft"),
    subtotalCents: integer("subtotal_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("invoices_number_unique").on(t.number),
    index("invoices_customer_id_idx").on(t.customerId),
    index("invoices_service_id_idx").on(t.serviceId),
    index("invoices_order_id_idx").on(t.orderId),
    index("invoices_status_idx").on(t.status),
    index("invoices_due_date_idx").on(t.dueDate),
    /*
     * Double-billing backstop (spec §6.1). Invoice generation already reads
     * for an existing period and locks the service row, but the last line of
     * defence against billing a customer twice for one month belongs in the
     * database, not in whichever caller happens to run next.
     *
     * Partial: adjustment invoices (plan changes) and order invoices carry no
     * service_id or no period_start and are legitimately many per service.
     * Applied by lib/db/migrations/0006_invoice_period_unique.sql.
     */
    uniqueIndex("invoices_service_period_unique")
      .on(t.serviceId, t.periodStart)
      .where(sql`${t.serviceId} is not null and ${t.periodStart} is not null`),
  ]
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: id(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    kind: invoiceLineKind("kind").notNull(),
    description: text("description").notNull(),
    serviceId: uuid("service_id").references(() => services.id),
    amountCents: integer("amount_cents").notNull(), // signed; credits negative
    qty: integer("qty").notNull().default(1),
    ...timestamps,
  },
  (t) => [
    index("invoice_lines_invoice_id_idx").on(t.invoiceId),
    index("invoice_lines_service_id_idx").on(t.serviceId),
  ]
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    method: paymentMethodKind("method").notNull(),
    amountCents: integer("amount_cents").notNull(),
    status: paymentStatus("status").notNull().default("initiated"),
    gatewayRef: text("gateway_ref"),
    failureReason: text("failure_reason"),
    recordedBy: uuid("recorded_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index("payments_invoice_id_idx").on(t.invoiceId),
    uniqueIndex("payments_gateway_ref_unique").on(t.gatewayRef),
    index("payments_status_idx").on(t.status),
  ]
);

export const paymentMethods = pgTable(
  "payment_methods",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    payfastToken: text("payfast_token").notNull(),
    cardLast4: text("card_last4"),
    cardBrand: text("card_brand"),
    status: storedPaymentMethodStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [index("payment_methods_customer_id_idx").on(t.customerId)]
);

export const collectionAttempts = pgTable(
  "collection_attempts",
  {
    id: id(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    attemptNo: integer("attempt_no").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    result: collectionResult("result"),
    detail: text("detail"),
    ...timestamps,
  },
  (t) => [
    index("collection_attempts_invoice_id_idx").on(t.invoiceId),
    index("collection_attempts_scheduled_for_idx").on(t.scheduledFor),
  ]
);

// ---------------------------------------------------------------------------
// §4.5 Communication and support
// ---------------------------------------------------------------------------

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    customerId: uuid("customer_id").references(() => customers.id),
    channel: conversationChannel("channel").notNull(),
    subject: text("subject"),
    status: conversationStatus("status").notNull().default("open"),
    assignedTo: uuid("assigned_to").references(() => users.id),
    priority: conversationPriority("priority").notNull().default("normal"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("conversations_customer_id_idx").on(t.customerId),
    index("conversations_status_idx").on(t.status),
    index("conversations_assigned_to_idx").on(t.assignedTo),
    index("conversations_last_message_at_idx").on(t.lastMessageAt),
  ]
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    direction: messageDirection("direction").notNull(),
    authorUserId: uuid("author_user_id").references(() => users.id),
    body: text("body").notNull(),
    attachments: jsonb("attachments").$type<string[]>().notNull().default([]),
    externalId: text("external_id"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("messages_conversation_id_idx").on(t.conversationId),
    uniqueIndex("messages_external_id_unique").on(t.externalId),
  ]
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    readAt: timestamp("read_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("notifications_user_id_idx").on(t.userId),
    index("notifications_read_at_idx").on(t.readAt),
  ]
);

// ---------------------------------------------------------------------------
// §4.6 Sales
// ---------------------------------------------------------------------------

export const leads = pgTable(
  "leads",
  {
    id: id(),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    source: leadSource("source").notNull().default("manual"),
    interest: text("interest"),
    addressText: text("address_text"),
    status: leadStatus("status").notNull().default("new"),
    ownerSalesId: uuid("owner_sales_id").references(() => users.id),
    lostReason: text("lost_reason"),
    convertedCustomerId: uuid("converted_customer_id").references(
      () => customers.id
    ),
    ...timestamps,
  },
  (t) => [
    index("leads_status_idx").on(t.status),
    index("leads_owner_sales_id_idx").on(t.ownerSalesId),
    index("leads_converted_customer_id_idx").on(t.convertedCustomerId),
  ]
);

export const leadActivities = pgTable(
  "lead_activities",
  {
    id: id(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    kind: leadActivityKind("kind").notNull(),
    body: text("body"),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [index("lead_activities_lead_id_idx").on(t.leadId)]
);

export const quotes = pgTable(
  "quotes",
  {
    id: id(),
    number: text("number").notNull(),
    leadId: uuid("lead_id").references(() => leads.id),
    customerId: uuid("customer_id").references(() => customers.id),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    status: quoteStatus("status").notNull().default("draft"),
    shareToken: text("share_token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    totalCents: integer("total_cents").notNull().default(0),
    firstViewedAt: timestamp("first_viewed_at", { withTimezone: true }),
    acceptedOrderId: uuid("accepted_order_id").references(() => orders.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("quotes_number_unique").on(t.number),
    uniqueIndex("quotes_share_token_unique").on(t.shareToken),
    index("quotes_lead_id_idx").on(t.leadId),
    index("quotes_customer_id_idx").on(t.customerId),
    index("quotes_created_by_idx").on(t.createdBy),
    index("quotes_status_idx").on(t.status),
  ]
);

export const quoteItems = pgTable(
  "quote_items",
  {
    id: id(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id),
    itemType: quoteItemType("item_type").notNull(),
    planId: uuid("plan_id").references(() => plans.id),
    hardwareId: uuid("hardware_id").references(() => hardwareProducts.id),
    bundleId: uuid("bundle_id").references(() => bundles.id),
    nameSnapshot: text("name_snapshot").notNull(),
    unitPriceCentsSnapshot: integer("unit_price_cents_snapshot").notNull(),
    unitCostCentsSnapshot: integer("unit_cost_cents_snapshot"),
    discountCents: integer("discount_cents").notNull().default(0),
    qty: integer("qty").notNull().default(1),
    ...timestamps,
  },
  (t) => [
    index("quote_items_quote_id_idx").on(t.quoteId),
    index("quote_items_plan_id_idx").on(t.planId),
    index("quote_items_hardware_id_idx").on(t.hardwareId),
    index("quote_items_bundle_id_idx").on(t.bundleId),
  ]
);

// ---------------------------------------------------------------------------
// §4.7 Compliance and system
// ---------------------------------------------------------------------------

export const ricaRecords = pgTable(
  "rica_records",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    // Nullable: RICA is captured at signup, before the service exists; the
    // service links up when it is created from the paid order (M3).
    serviceId: uuid("service_id").references(() => services.id),
    simId: uuid("sim_id").references(() => sims.id),
    idNumberEncrypted: text("id_number_encrypted").notNull(),
    idDocPath: text("id_doc_path"),
    poaDocPath: text("poa_doc_path"),
    status: ricaStatus("status").notNull().default("pending"),
    rejectionReason: text("rejection_reason"),
    verifiedBy: uuid("verified_by").references(() => users.id),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("rica_records_customer_id_idx").on(t.customerId),
    index("rica_records_service_id_idx").on(t.serviceId),
    index("rica_records_status_idx").on(t.status),
  ]
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    actorUserId: uuid("actor_user_id"), // nullable for system
    actorRole: text("actor_role").notNull(),
    action: text("action").notNull(), // dot notation, e.g. service.suspend
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    before: jsonb("before").$type<Record<string, unknown> | null>(),
    after: jsonb("after").$type<Record<string, unknown> | null>(),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entity, t.entityId),
    index("audit_log_actor_idx").on(t.actorUserId),
    index("audit_log_created_at_idx").on(t.createdAt),
  ]
);

export const domainEvents = pgTable(
  "domain_events",
  {
    id: id(),
    name: text("name").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    forwardedAt: timestamp("forwarded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("domain_events_forwarded_at_idx").on(t.forwardedAt),
    index("domain_events_name_idx").on(t.name),
  ]
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  ...timestamps,
});

// §10.5 Number sequences: per-year counters with a transactional getter.
export const numberSequences = pgTable(
  "number_sequences",
  {
    prefix: text("prefix").notNull(), // 'NC' | 'INV' | 'Q'
    year: integer("year").notNull(),
    lastValue: integer("last_value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.prefix, t.year] })]
);

// OTP codes (hashed at rest, 5-minute expiry, rate-limited at the endpoint).
export const otpCodes = pgTable(
  "otp_codes",
  {
    id: id(),
    phone: text("phone").notNull(),
    codeHash: text("code_hash").notNull(),
    ip: text("ip"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index("otp_codes_phone_idx").on(t.phone),
    index("otp_codes_expires_at_idx").on(t.expiresAt),
  ]
);

// One-time staff invite / setup tokens.
export const inviteTokens = pgTable(
  "invite_tokens",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("invite_tokens_user_id_idx").on(t.userId)]
);

// Server-held signup drafts keyed by a cookie (spec §9.2).
export const signupDrafts = pgTable(
  "signup_drafts",
  {
    id: id(),
    draftKey: text("draft_key").notNull(),
    state: jsonb("state")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ...timestamps,
  },
  (t) => [uniqueIndex("signup_drafts_key_unique").on(t.draftKey)]
);
