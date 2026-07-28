import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  services,
  plans,
  customers,
  provisioningTasks,
  ricaRecords,
  invoices,
  collectionAttempts,
  conversations,
  leads,
  hardwareProducts,
} from "@/lib/db/schema";
import { EmptyState } from "@/components/shared/empty-state";
import { MoneyText } from "@/components/shared/money-text";
import { maskedIdNumber } from "@/lib/domain/rica";
import {
  invoicesAwaitingDecision,
  outstandingCents,
  paidCentsByInvoice,
} from "@/lib/domain/billing";
import { DEFAULT_DUNNING } from "@/lib/domain/billing-engine";
import {
  unallocatedPayments,
  unallocatedPaymentsSummary,
} from "@/lib/domain/reports";
import { getSettingOr } from "@/lib/domain/settings";
import { formatDate, formatDateTime } from "@/lib/format";
import { filterPillClass } from "@/components/ui/filter-pill";
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

/** Stable anchor id for the section jump list. */
function sectionId(title: string): string {
  return `queue-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

/** Today (spec §9.4.1): a queue, not a dashboard. */
export default async function AdminTodayPage() {
  // Slim strip: active services, MRR, open conversations, that is all.
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

  // Only the customers on the queue, not every verified RICA row in the
  // database, just to badge a handful of cards.
  const taskCustomerIds = [...new Set(taskRows.map((r) => r.customer.id))];
  const verifiedRicaCustomerIds = new Set(
    taskCustomerIds.length === 0
      ? []
      : (
          await db
            .select({ customerId: ricaRecords.customerId })
            .from(ricaRecords)
            .where(
              and(
                eq(ricaRecords.status, "verified"),
                inArray(ricaRecords.customerId, taskCustomerIds)
              )
            )
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
  const pastDueRows = await db
    .select({ invoice: invoices, customer: customers })
    .from(invoices)
    .innerJoin(customers, eq(invoices.customerId, customers.id))
    .where(inArray(invoices.status, ["past_due"]))
    .orderBy(invoices.dueDate)
    .limit(40);

  // 2b. Card charges the bank refused. collection_attempts has recorded
  // these since M4 and nothing has ever read them, so the first a human
  // heard of a failing card was the suspension call.
  const failedCharges = await db
    .select({
      attempt: collectionAttempts,
      invoice: invoices,
      customer: customers,
    })
    .from(collectionAttempts)
    .innerJoin(invoices, eq(collectionAttempts.invoiceId, invoices.id))
    .innerJoin(customers, eq(invoices.customerId, customers.id))
    .where(
      and(
        eq(collectionAttempts.result, "failed"),
        inArray(invoices.status, ["open", "past_due"])
      )
    )
    .orderBy(desc(collectionAttempts.executedAt))
    .limit(20);

  // 2c. The §6.3 day-40 call: cancel the service or write the invoice off.
  // The dunning sweep only rings a bell, which vanishes once it is read.
  const dunning = await getSettingOr("dunning", DEFAULT_DUNNING);
  const decisionRows = await invoicesAwaitingDecision(dunning.adminDecisionDay);

  // What is still owed on each invoice on these three queues, never the
  // invoice total. A part payment deliberately leaves the invoice open (§6.2),
  // so a queue built on totals sends an operator to chase an R800 invoice that
  // has R600 banked against it for the full R800. `outstandingCents` is the
  // same rule the age analysis and the customer's own statement use, so the
  // collections call and the customer's screen can never disagree.
  const queueInvoiceIds = [
    ...new Set([
      ...pastDueRows.map((r) => r.invoice.id),
      ...failedCharges.map((r) => r.invoice.id),
      ...decisionRows.map((r) => r.invoice.id),
    ]),
  ];
  const paidOnQueues = await paidCentsByInvoice(queueInvoiceIds);
  const owedOn = (invoice: { id: string; totalCents: number }) =>
    outstandingCents(invoice.totalCents, paidOnQueues.get(invoice.id) ?? 0);

  // An invoice with nothing left outstanding is settled, whatever its status
  // column still says, so it is off the chase list entirely.
  const decisions = decisionRows.filter((row) => owedOn(row.invoice) > 0);
  // Anything at the decision point gets its own section, so it does not fill
  // the past-due list twice: oldest-first ordering would put it at the top.
  const decisionIds = new Set(decisions.map((d) => d.invoice.id));
  const pastDue = pastDueRows
    .filter((row) => !decisionIds.has(row.invoice.id) && owedOn(row.invoice) > 0)
    .slice(0, 20);
  const chargeFailures = failedCharges.filter(
    (row) => owedOn(row.invoice) > 0
  );

  // 2d. Money PayFast took that no invoice could absorb. Round 4 banks it,
  // audits it, events it and rings a bell; a bell is read once and gone, so
  // this is the standing queue that money sits on until a person deals with it.
  const [unallocated, unallocatedTotals] = await Promise.all([
    unallocatedPayments(20),
    unallocatedPaymentsSummary(),
  ]);

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
                  {invoice.number}, due {formatDate(invoice.dueDate)}
                </span>
              </span>
              <MoneyText cents={owedOn(invoice)} className="font-medium" />
            </Link>
          ))}
        </div>
      ),
    },
    {
      title: "Card charges failing",
      count: chargeFailures.length,
      emptyText: "No card charge has been refused on an unpaid invoice.",
      body: (
        <div className="space-y-2">
          {chargeFailures.map(({ attempt, invoice, customer }) => (
            <Link
              key={attempt.id}
              href={`/admin/customers/${customer.id}?tab=billing`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-4 hover:border-primary/40"
            >
              <span>
                <span className="font-medium">
                  {customerDisplayName(customer)}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {invoice.number}, attempt {attempt.attemptNo}
                  {attempt.executedAt
                    ? ` on ${formatDateTime(attempt.executedAt)}`
                    : ""}
                </span>
                <span className="block text-sm text-red-600">
                  {attempt.detail ?? "the bank gave no reason"}
                </span>
              </span>
              <MoneyText cents={owedOn(invoice)} className="font-medium" />
            </Link>
          ))}
        </div>
      ),
    },
    {
      title: "Money to allocate or refund",
      count: unallocatedTotals.count,
      emptyText:
        "Every payment PayFast has taken landed on an invoice that could absorb it.",
      body: (
        <div className="space-y-2">
          {unallocated.map((row) => (
            <Link
              key={row.eventId}
              href="/admin/billing?tab=unallocated"
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-card p-4 hover:border-primary/40"
            >
              <span>
                <span className="font-medium">
                  {row.customerName || "(no name)"}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {row.invoiceNumber}, received{" "}
                  {formatDateTime(row.receivedAt)}
                </span>
                <span className="block text-sm text-amber-700">
                  {row.reason ||
                    "The invoice could not absorb this money. Allocate it or refund it."}
                </span>
              </span>
              <MoneyText
                cents={row.unallocatedCents}
                className="font-medium text-amber-700"
              />
            </Link>
          ))}
          {unallocatedTotals.count > unallocated.length ? (
            <Link
              href="/admin/billing?tab=unallocated"
              className="block text-sm font-medium text-primary hover:underline"
            >
              {unallocatedTotals.count - unallocated.length} more waiting, see
              all in Billing
            </Link>
          ) : null}
        </div>
      ),
    },
    {
      title: "Decisions needed: cancel or write off",
      count: decisions.length,
      emptyText: `Nothing has been unpaid for ${dunning.adminDecisionDay} days.`,
      body: (
        <div className="space-y-2">
          {decisions.map(({ invoice, customer, service }) => (
            <Link
              key={invoice.id}
              href={`/admin/customers/${customer.id}?tab=billing`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-card p-4 hover:border-primary/40"
            >
              <span>
                <span className="font-medium">
                  {customerDisplayName(customer)}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {invoice.number}, issued {formatDate(invoice.issueDate)}
                  {service ? `, service ${service.status}` : ""}
                </span>
                <span className="block text-sm text-amber-700">
                  Cancel the service or write the invoice off, nothing happens
                  automatically.
                </span>
              </span>
              <MoneyText cents={owedOn(invoice)} className="font-medium" />
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

      {/* Slim strip (spec: active services, MRR, open conversations, that is all) */}
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

      {/* Jump list: a busy morning is otherwise one long scroll with no way
          to see at a glance where the work is. */}
      <nav aria-label="Queue sections" className="flex flex-wrap gap-1.5">
        {sections.map((section) => (
          // A plain anchor, not FilterPillLink: these jump within the page
          // rather than filtering it, so nothing here is ever the current
          // filter. Only the shared pill's shape and coarse-pointer floor
          // are wanted, which is what filterPillClass gives.
          <a
            key={section.title}
            href={`#${sectionId(section.title)}`}
            className={filterPillClass(false, {
              size: "sm",
              className: section.count > 0 ? "font-medium text-foreground" : "",
            })}
          >
            {section.title}
            <span className="tnum">{section.count}</span>
          </a>
        ))}
      </nav>

      {sections.map((section) => (
        <section key={section.title} id={sectionId(section.title)}>
          <h2 className="mb-2 scroll-mt-20 text-sm font-semibold">
            {section.title}
            {section.count > 0 ? (
              <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                {section.count}
              </span>
            ) : null}
          </h2>
          {section.count === 0 ? (
            <EmptyState compact description={section.emptyText} />
          ) : (
            section.body
          )}
        </section>
      ))}
    </div>
  );
}
