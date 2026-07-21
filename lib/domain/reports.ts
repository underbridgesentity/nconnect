import "server-only";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  services,
  plans,
  providers,
  invoices,
  customers,
} from "@/lib/db/schema";
import { todayInJohannesburg } from "./services";

/**
 * Reports (spec §6.4, §9.4.6). Everything computed from live records, * margin is price - cost where cost is present; nothing invented.
 */

export async function activeServicesByCategory() {
  return db
    .select({
      category: plans.category,
      count: sql<number>`count(*)::int`,
      mrrCents: sql<number>`sum(${plans.priceCents})::int`,
    })
    .from(services)
    .innerJoin(plans, eq(services.planId, plans.id))
    .where(eq(services.status, "active"))
    .groupBy(plans.category);
}

export async function activeServicesByProvider() {
  return db
    .select({
      provider: providers.name,
      count: sql<number>`count(*)::int`,
      mrrCents: sql<number>`sum(${plans.priceCents})::int`,
      marginCents: sql<number>`sum(${plans.priceCents} - ${plans.costCents}) filter (where ${plans.costCents} is not null)::int`,
      missingCost: sql<number>`count(*) filter (where ${plans.costCents} is null)::int`,
    })
    .from(services)
    .innerJoin(plans, eq(services.planId, plans.id))
    .innerJoin(providers, eq(plans.providerId, providers.id))
    .where(eq(services.status, "active"))
    .groupBy(providers.name);
}

/** Activations vs cancellations per month, last 12 months. */
export async function activationsVsCancellations() {
  const rows = await db
    .select({
      month: sql<string>`to_char(${services.activationDate}, 'YYYY-MM')`,
      activations: sql<number>`count(*)::int`,
    })
    .from(services)
    .where(
      and(
        sql`${services.activationDate} is not null`,
        gte(services.activationDate, sql`(current_date - interval '12 months')::date`)
      )
    )
    .groupBy(sql`to_char(${services.activationDate}, 'YYYY-MM')`);

  const cancels = await db
    .select({
      month: sql<string>`to_char(${services.cancelEffectiveDate}, 'YYYY-MM')`,
      cancellations: sql<number>`count(*)::int`,
    })
    .from(services)
    .where(
      and(
        eq(services.status, "cancelled"),
        sql`${services.cancelEffectiveDate} is not null`
      )
    )
    .groupBy(sql`to_char(${services.cancelEffectiveDate}, 'YYYY-MM')`);

  const months = new Map<string, { activations: number; cancellations: number }>();
  for (const row of rows) {
    months.set(row.month, { activations: row.activations, cancellations: 0 });
  }
  for (const row of cancels) {
    const entry = months.get(row.month) ?? { activations: 0, cancellations: 0 };
    entry.cancellations = row.cancellations;
    months.set(row.month, entry);
  }
  return [...months.entries()]
    .map(([month, v]) => ({ month, ...v }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** Plans in use with missing cost prices, the "set cost prices" checklist. */
export async function missingCostChecklist() {
  return db
    .select({
      planName: plans.name,
      provider: providers.name,
      activeServices: sql<number>`count(${services.id}) filter (where ${services.status} = 'active')::int`,
    })
    .from(plans)
    .innerJoin(providers, eq(plans.providerId, providers.id))
    .leftJoin(services, eq(services.planId, plans.id))
    .where(and(isNull(plans.costCents), eq(plans.status, "published")))
    .groupBy(plans.name, providers.name);
}

/**
 * Reconciliation worksheet (spec §6.4): expected wholesale for a month and
 * provider vs the provider statement. Matching by external_ref when a CSV
 * is supplied; nothing auto-adjusts.
 */
export interface ReconRow {
  serviceId: string;
  customerName: string;
  planName: string;
  externalRef: string | null;
  expectedCostCents: number | null;
  statementCents: number | null;
  flag: "ok" | "missing_from_statement" | "amount_delta" | "no_cost_price";
}

export async function reconciliationWorksheet(input: {
  providerName: string;
  statement?: Map<string, number>; // external_ref -> cents
}): Promise<{
  rows: ReconRow[];
  leakage: { externalRef: string; statementCents: number }[];
  expectedTotalCents: number;
}> {
  const { providerAccounts } = await import("@/lib/db/schema");
  const active = await db
    .select({
      service: services,
      plan: plans,
      customer: customers,
      provider: providers,
    })
    .from(services)
    .innerJoin(plans, eq(services.planId, plans.id))
    .innerJoin(providers, eq(plans.providerId, providers.id))
    .innerJoin(customers, eq(services.customerId, customers.id))
    .where(
      and(
        inArray(services.status, ["active", "suspended"]),
        eq(providers.name, input.providerName)
      )
    );

  const refs = await db
    .select()
    .from(providerAccounts)
    .where(
      inArray(
        providerAccounts.serviceId,
        active.map((a) => a.service.id).concat("00000000-0000-0000-0000-000000000000")
      )
    );

  const matchedRefs = new Set<string>();
  const rows: ReconRow[] = active.map(({ service, plan, customer }) => {
    const account = refs.find((r) => r.serviceId === service.id);
    const externalRef = account?.externalRef ?? null;
    const expected = plan.costCents;
    let statementCents: number | null = null;
    let flag: ReconRow["flag"] = "ok";
    if (expected == null) flag = "no_cost_price";
    if (input.statement) {
      statementCents =
        externalRef != null ? (input.statement.get(externalRef) ?? null) : null;
      if (externalRef && statementCents != null) matchedRefs.add(externalRef);
      if (statementCents == null) flag = "missing_from_statement";
      else if (expected != null && statementCents !== expected) {
        flag = "amount_delta";
      }
    }
    return {
      serviceId: service.id,
      customerName:
        customer.companyName ??
        [customer.firstName, customer.lastName].filter(Boolean).join(" "),
      planName: plan.name,
      externalRef,
      expectedCostCents: expected,
      statementCents,
      flag,
    };
  });

  // On-statement but not active on platform: leakage.
  const leakage = input.statement
    ? [...input.statement.entries()]
        .filter(([ref]) => !matchedRefs.has(ref))
        .map(([externalRef, statementCents]) => ({ externalRef, statementCents }))
    : [];

  const expectedTotalCents = rows.reduce(
    (sum, r) => sum + (r.expectedCostCents ?? 0),
    0
  );
  return { rows, leakage, expectedTotalCents };
}

export async function collectionsSummary(today = todayInJohannesburg()) {
  const [row] = await db
    .select({
      openCount: sql<number>`count(*) filter (where ${invoices.status} = 'open')::int`,
      openCents: sql<number>`coalesce(sum(${invoices.totalCents}) filter (where ${invoices.status} = 'open'), 0)::int`,
      pastDueCount: sql<number>`count(*) filter (where ${invoices.status} = 'past_due')::int`,
      pastDueCents: sql<number>`coalesce(sum(${invoices.totalCents}) filter (where ${invoices.status} = 'past_due'), 0)::int`,
      paidThisMonthCents: sql<number>`coalesce(sum(${invoices.totalCents}) filter (where ${invoices.status} = 'paid' and to_char(${invoices.paidAt}, 'YYYY-MM') = ${today.slice(0, 7)}), 0)::int`,
    })
    .from(invoices);
  return row;
}

export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}