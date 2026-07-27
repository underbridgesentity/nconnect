import "server-only";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  services,
  plans,
  providers,
  invoices,
  payments,
  customers,
} from "@/lib/db/schema";
import { add, parseZar } from "@/lib/money";
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
 * Parse a provider or bank statement CSV into integer cents.
 *
 * South African exports routinely write "R1 234,56" or "1 234.56". A
 * `parseFloat` on those returns 1, which silently reconciles an entire
 * statement as amount deltas, so every amount goes through `parseZar`
 * (integer cents, throws on junk) and anything unreadable is reported back
 * to the operator instead of being dropped on the floor.
 */
export interface ParsedStatement {
  amounts: Map<string, number>;
  /** Lines that could not be read, so the UI can say "N rows ignored". */
  unreadable: { line: number; text: string }[];
}

/** CSV split that respects double quotes and doubled escapes. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

/**
 * Normalise an amount written in either South African convention into the
 * canonical "1234.56" that `parseZar` accepts. "R1 234,56", "1.234,56",
 * "1 234.56" and "1234.56" are all R1 234.56. Whichever separator comes
 * last, with one or two digits after it, is the decimal separator; every
 * other separator is a thousands mark. Accounting exports also write the
 * minus sign after the number.
 */
function normaliseAmount(raw: string): string {
  let value = raw.trim();
  let negative = false;
  if (value.startsWith("-")) {
    negative = true;
    value = value.slice(1);
  }
  if (value.endsWith("-")) {
    negative = true;
    value = value.slice(0, -1);
  }
  value = value.replace(/^(ZAR|R)\s*/i, "").replace(/[\s ]/g, "");
  // Reject anything that is not sanely grouped, so junk like "1.2.3.4" is
  // reported as unreadable instead of quietly read as R123.40.
  const grouped = /^\d{1,3}([.,]\d{3})*([.,]\d{1,2})?$/;
  const plain = /^\d+([.,]\d{1,2})?$/;
  if (!grouped.test(value) && !plain.test(value)) {
    throw new TypeError(`cannot read "${raw}" as an amount`);
  }

  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");
  let decimalAt = -1;
  if (lastComma >= 0 && lastDot >= 0) {
    decimalAt = Math.max(lastComma, lastDot);
  } else if (lastComma >= 0) {
    decimalAt = /,\d{1,2}$/.test(value) ? lastComma : -1;
  } else if (lastDot >= 0) {
    decimalAt = /\.\d{1,2}$/.test(value) ? lastDot : -1;
  }

  const whole = (decimalAt >= 0 ? value.slice(0, decimalAt) : value).replace(
    /[.,]/g,
    ""
  );
  const fraction = decimalAt >= 0 ? value.slice(decimalAt + 1) : "";
  const normalised = fraction ? `${whole}.${fraction}` : whole;
  return negative ? `-${normalised}` : normalised;
}

export function parseStatementCsv(text: string): ParsedStatement {
  const amounts = new Map<string, number>();
  const unreadable: { line: number; text: string }[] = [];

  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const cells = splitCsvLine(line);
    const ref = cells[0];
    // Header row: "external_ref,amount".
    if (index === 0 && cells.slice(1).some((c) => /[a-z]/i.test(c))) continue;
    if (!ref || cells.length < 2) {
      unreadable.push({ line: index + 1, text: line });
      continue;
    }

    // An unquoted decimal comma splits the amount across cells, so try the
    // documented second column first, then the rejoined remainder.
    const candidates =
      cells.length > 2
        ? [cells[1], cells.slice(1).join(",")]
        : [cells[1]];
    let parsed: number | null = null;
    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        parsed = parseZar(normaliseAmount(candidate));
        break;
      } catch {
        // try the next reading of the line
      }
    }
    if (parsed == null) {
      unreadable.push({ line: index + 1, text: line });
      continue;
    }
    amounts.set(ref, parsed);
  }
  return { amounts, unreadable };
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
    (sum, r) => add(sum, r.expectedCostCents ?? 0),
    0
  );
  return { rows, leakage, expectedTotalCents };
}

/**
 * The collections tile: what is owed now, and what has actually come in.
 *
 * The money figures are outstanding balances, never invoice totals. A part
 * payment leaves the invoice open on purpose (§6.2), so summing totals told an
 * operator the book was worth more than it was and put customers who had
 * already paid most of their bill at the top of the chase list. `greatest(...,
 * 0)` is the `outstandingCents` rule in SQL: an over-allocated invoice is a
 * data problem to investigate, never a credit that cancels another invoice's
 * debt.
 *
 * The counts stay document counts, so they still reconcile line for line with
 * the invoice list they link to.
 *
 * "Collected this month" counts payments, not invoices. Reading it off
 * `paid_at` credited the whole invoice to whichever month it finally settled
 * in, and ignored every rand collected against invoices that are still open.
 */
export async function collectionsSummary(today = todayInJohannesburg()) {
  const paidPerInvoice = sql<number>`coalesce((
    select sum(${payments.amountCents})
    from ${payments}
    where ${payments.invoiceId} = ${invoices.id}
      and ${payments.status} = 'complete'
  ), 0)`;
  const outstanding = sql<number>`greatest(${invoices.totalCents} - ${paidPerInvoice}, 0)`;

  const [row] = await db
    .select({
      openCount: sql<number>`count(*) filter (where ${invoices.status} = 'open')::int`,
      openCents: sql<number>`coalesce(sum(${outstanding}) filter (where ${invoices.status} = 'open'), 0)::int`,
      pastDueCount: sql<number>`count(*) filter (where ${invoices.status} = 'past_due')::int`,
      pastDueCents: sql<number>`coalesce(sum(${outstanding}) filter (where ${invoices.status} = 'past_due'), 0)::int`,
    })
    .from(invoices);

  // Timestamps are stored UTC and the month is a Johannesburg month, so the
  // conversion is explicit: without it a payment banked at 00:30 on the first
  // lands in the month before.
  const [collected] = await db
    .select({
      paidThisMonthCents: sql<number>`coalesce(sum(${payments.amountCents}) filter (
        where ${payments.status} = 'complete'
          and to_char(${payments.createdAt} at time zone 'Africa/Johannesburg', 'YYYY-MM') = ${today.slice(0, 7)}
      ), 0)::int`,
    })
    .from(payments);

  return { ...row, paidThisMonthCents: collected.paidThisMonthCents };
}

export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}