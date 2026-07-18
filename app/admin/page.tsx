import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  services,
  plans,
  customers,
  provisioningTasks,
  ricaRecords,
  invoices,
  conversations,
  leads,
  hardwareProducts,
} from "@/lib/db/schema";
import { MoneyText } from "@/components/shared/money-text";
import { maskedIdNumber } from "@/lib/domain/rica";
import {
  TaskCard,
  FeasibilityCard,
  RicaCard,
  type TaskCardData,
  type FeasibilityCardData,
  type RicaCardData,
} from "./today-cards";

export const metadata: Metadata = { title: "Today" };

function customerDisplayName(c: typeof customers.$inferSelect): string {
  return c.companyName ?? [c.firstName, c.lastName].filter(Boolean).join(" ");
}

const SIM_CATEGORIES = ["lte_home", "telkom_lte", "sim_data"];

/** Today (spec §9.4.1): a queue, not a dashboard. */
export default async function AdminTodayPage() {
  // Slim strip: active services, MRR, open conversations — that is all.
  const [strip] = await db
    .select({
      activeServices: sql<number>`count(*) filter (where ${services.status} = 'active')::int`,
      mrrCents: sql<number>`coalesce(sum(${plans.priceCents}) filter (where ${services.status} = 'active'), 0)::int`,
    })
    .from(services)
    .innerJoin(plans, eq(services.planId, plans.id));
  const [convCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(conversations)
    .where(eq(conversations.status, "open"));

  // 1. Provisioning tasks due (excluding feasibility, shown in §4 below)
  const taskRows = await db
    .select({
      task: provisioningTasks,
      service: services,
      plan: plans,
      customer: customers,
    })
    .from(provisioningTasks)
    .innerJoin(services, eq(provisioningTasks.serviceId, services.id))
    .innerJoin(plans, eq(services.planId, plans.id))
    .innerJoin(customers, eq(services.customerId, customers.id))
    .where(inArray(provisioningTasks.status, ["open", "in_progress", "blocked"]))
    .orderBy(provisioningTasks.dueAt);

  const verifiedRicaCustomerIds = new Set(
    (
      await db
        .select({ customerId: ricaRecords.customerId })
        .from(ricaRecords)
        .where(eq(ricaRecords.status, "verified"))
    ).map((r) => r.customerId)
  );

  const tasks: TaskCardData[] = taskRows.map((row) => ({
    id: row.task.id,
    type: row.task.type,
    status: row.task.status,
    dueAt: row.task.dueAt?.toISOString() ?? null,
    checklist: row.task.checklist,
    serviceName: row.plan.name,
    customerName: customerDisplayName(row.customer),
    category: row.plan.category,
    isSim: SIM_CATEGORIES.includes(row.plan.category),
    ricaVerified: verifiedRicaCustomerIds.has(row.customer.id),
  }));

  // 2. Payments failing / past due
  const pastDue = await db
    .select({ invoice: invoices, customer: customers })
    .from(invoices)
    .innerJoin(customers, eq(invoices.customerId, customers.id))
    .where(inArray(invoices.status, ["past_due"]))
    .orderBy(invoices.dueDate)
    .limit(20);

  // 3. Unassigned or waiting conversations
  const waitingConvs = await db
    .select({ conversation: conversations, customer: customers })
    .from(conversations)
    .leftJoin(customers, eq(conversations.customerId, customers.id))
    .where(
      and(eq(conversations.status, "open"), isNull(conversations.assignedTo))
    )
    .orderBy(conversations.lastMessageAt)
    .limit(20);

  // 4. Fibre feasibility requests
  const feasibilityRows = await db
    .select({ task: provisioningTasks, lead: leads })
    .from(provisioningTasks)
    .innerJoin(leads, eq(provisioningTasks.leadId, leads.id))
    .where(
      and(
        eq(provisioningTasks.type, "feasibility_check"),
        inArray(provisioningTasks.status, ["open", "in_progress"])
      )
    )
    .orderBy(provisioningTasks.dueAt);
  const feasibility: FeasibilityCardData[] = feasibilityRows.map((row) => ({
    taskId: row.task.id,
    leadName: row.lead.name,
    leadPhone: row.lead.phone,
    addressText: row.lead.addressText,
    interest: row.lead.interest,
    dueAt: row.task.dueAt?.toISOString() ?? null,
  }));

  // 5. RICA pending verification
  const ricaRows = await db
    .select({ record: ricaRecords, customer: customers })
    .from(ricaRecords)
    .innerJoin(customers, eq(ricaRecords.customerId, customers.id))
    .where(eq(ricaRecords.status, "pending"));
  const rica: RicaCardData[] = ricaRows.map((row) => ({
    id: row.record.id,
    customerName: customerDisplayName(row.customer),
    maskedId: maskedIdNumber(row.record.idNumberEncrypted),
    createdAt: row.record.createdAt.toISOString(),
  }));

  // 6. True low stock (at or below threshold only, published)
  const lowStock = await db
    .select()
    .from(hardwareProducts)
    .where(
      and(
        eq(hardwareProducts.status, "published"),
        lte(hardwareProducts.stockQty, hardwareProducts.lowStockThreshold)
      )
    )
    .orderBy(hardwareProducts.stockQty);

  const sections: {
    title: string;
    count: number;
    body: React.ReactNode;
    emptyText: string;
  }[] = [
    {
      title: "Provisioning tasks due",
      count: tasks.length,
      emptyText: "Nothing to provision right now.",
      body: (
        <div className="space-y-2">
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} />
          ))}
        </div>
      ),
    },
    {
      title: "Payments failing / past due",
      count: pastDue.length,
      emptyText: "No invoices are past due.",
      body: (
        <div className="space-y-2">
          {pastDue.map(({ invoice, customer }) => (
            <Link
              key={invoice.id}
              href={`/admin/customers/${customer.id}?tab=billing`}
              className="flex items-center justify-between rounded-lg border bg-card p-4 hover:border-primary/40"
            >
              <span>
                <span className="font-medium">{customerDisplayName(customer)}</span>
                <span className="block text-sm text-muted-foreground">
                  {invoice.number} — due {invoice.dueDate}
                </span>
              </span>
              <MoneyText cents={invoice.totalCents} className="font-medium" />
            </Link>
          ))}
        </div>
      ),
    },
    {
      title: "Waiting conversations",
      count: waitingConvs.length,
      emptyText: "No unassigned or waiting conversations.",
      body: (
        <div className="space-y-2">
          {waitingConvs.map(({ conversation, customer }) => (
            <Link
              key={conversation.id}
              href={`/admin/inbox?c=${conversation.id}`}
              className="flex items-center justify-between rounded-lg border bg-card p-4 hover:border-primary/40"
            >
              <span>
                <span className="font-medium">
                  {customer ? customerDisplayName(customer) : "Unidentified"}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {conversation.subject ?? conversation.channel}
                </span>
              </span>
            </Link>
          ))}
        </div>
      ),
    },
    {
      title: "Fibre feasibility requests",
      count: feasibility.length,
      emptyText: "No feasibility checks waiting.",
      body: (
        <div className="space-y-2">
          {feasibility.map((f) => (
            <FeasibilityCard key={f.taskId} item={f} />
          ))}
        </div>
      ),
    },
    {
      title: "RICA pending verification",
      count: rica.length,
      emptyText: "No RICA records waiting for verification.",
      body: (
        <div className="space-y-2">
          {rica.map((r) => (
            <RicaCard key={r.id} record={r} />
          ))}
        </div>
      ),
    },
    {
      title: "Low stock",
      count: lowStock.length,
      emptyText: "All stock levels are above their thresholds.",
      body: (
        <div className="space-y-2">
          {lowStock.map((h) => (
            <Link
              key={h.id}
              href="/admin/catalogue?tab=hardware"
              className="flex items-center justify-between rounded-lg border bg-card p-4 hover:border-primary/40"
            >
              <span className="font-medium">{h.name}</span>
              <span className="tnum text-sm text-amber-700">
                {h.stockQty} in stock (threshold {h.lowStockThreshold})
              </span>
            </Link>
          ))}
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
        <p className="text-sm text-muted-foreground">
          Work that needs a human, in one list.
        </p>
      </div>

      {/* Slim strip (spec: active services, MRR, open conversations — that is all) */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Active services</p>
          <p className="tnum text-xl font-semibold">{strip.activeServices}</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">MRR</p>
          <p className="text-xl font-semibold">
            <MoneyText cents={strip.mrrCents} whole />
          </p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Open conversations</p>
          <p className="tnum text-xl font-semibold">{convCount.n}</p>
        </div>
      </div>

      {sections.map((section) => (
        <section key={section.title}>
          <h2 className="mb-2 text-sm font-semibold">
            {section.title}
            {section.count > 0 ? (
              <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                {section.count}
              </span>
            ) : null}
          </h2>
          {section.count === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              {section.emptyText}
            </p>
          ) : (
            section.body
          )}
        </section>
      ))}
    </div>
  );
}
