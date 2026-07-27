import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { ContactRound } from "lucide-react";
import { db } from "@/lib/db/client";
import { leads } from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import { normalizePhone } from "@/lib/auth/otp";
import { formatAge, formatDateTime } from "@/lib/format";
import { StatusPill } from "@/components/shared/status-pill";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";
import { QuickAddLead, ClaimButton } from "./client";

export const metadata: Metadata = { title: "Leads" };

const STATUSES = ["open", "new", "contacted", "quoted", "won", "lost", "all"] as const;
type StatusFilter = (typeof STATUSES)[number];
const OPEN_STATUSES = ["new", "contacted", "quoted"] as const;
const STATUS_LABEL: Record<StatusFilter, string> = {
  open: "Open",
  new: "New",
  contacted: "Contacted",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
  all: "All",
};

const SCOPES = ["mine", "pool", "all"] as const;
type ScopeFilter = (typeof SCOPES)[number];

const PAGE_SIZE = 25;

/**
 * Search matches a name, an interest note, or a phone number typed any way a
 * South African would type it (082…, 27…, +27…). The phone is normalised so
 * all three forms hit the stored E.164 value.
 */
function searchPredicate(term: string): SQL | undefined {
  const like = `%${term}%`;
  const clauses: SQL[] = [ilike(leads.name, like), ilike(leads.interest, like)];
  const digits = term.replace(/[\s()-]/g, "");
  if (/\d{3,}/.test(digits)) {
    try {
      clauses.push(eq(leads.phone, normalizePhone(digits)));
    } catch {
      // A partial number is still worth a suffix match.
      clauses.push(ilike(leads.phone, `%${digits.replace(/^(\+27|27|0)/, "")}%`));
    }
  }
  return or(...clauses);
}

export default async function SalesLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; scope?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const actor = await currentActor();
  if (!actor) redirect("/staff-login");

  const status: StatusFilter = STATUSES.includes(params.status as StatusFilter)
    ? (params.status as StatusFilter)
    : "open";
  const scope: ScopeFilter = SCOPES.includes(params.scope as ScopeFilter)
    ? (params.scope as ScopeFilter)
    : "mine";
  const search = params.q?.trim() ?? "";
  const page = Math.max(1, Number(params.page) || 1);

  const mine = eq(leads.ownerSalesId, actor.userId);
  const unclaimed = isNull(leads.ownerSalesId);
  // Reps see their own leads and the unclaimed pool; admins see everything.
  const scopeWhere =
    scope === "mine"
      ? mine
      : scope === "pool"
        ? unclaimed
        : actor.role === "admin"
          ? undefined
          : or(mine, unclaimed);

  const statusWhere =
    status === "all"
      ? undefined
      : status === "open"
        ? inArray(leads.status, [...OPEN_STATUSES])
        : eq(leads.status, status);

  const searchWhere = search ? searchPredicate(search) : undefined;
  const where = and(scopeWhere, statusWhere, searchWhere);

  // Counts come from the same predicate the list uses, so a tab never claims
  // a number the page it opens cannot show.
  const [rows, tabCounts, poolWaiting] = await Promise.all([
    db
      .select()
      .from(leads)
      .where(where)
      .orderBy(desc(leads.createdAt), desc(leads.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({ status: leads.status, n: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(scopeWhere, searchWhere))
      .groupBy(leads.status),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(unclaimed, inArray(leads.status, [...OPEN_STATUSES]))),
  ]);

  const countFor = (s: StatusFilter): number => {
    if (s === "all") return tabCounts.reduce((sum, c) => sum + c.n, 0);
    if (s === "open") {
      return tabCounts
        .filter((c) => (OPEN_STATUSES as readonly string[]).includes(c.status))
        .reduce((sum, c) => sum + c.n, 0);
    }
    return tabCounts.find((c) => c.status === s)?.n ?? 0;
  };
  const total = countFor(status);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const href = (next: Partial<{ status: string; scope: string; q: string; page: number }>) => {
    const qs = new URLSearchParams();
    const merged = { status, scope, q: search, page: 1, ...next };
    if (merged.status !== "open") qs.set("status", merged.status);
    if (merged.scope !== "mine") qs.set("scope", merged.scope);
    if (merged.q) qs.set("q", merged.q);
    if (merged.page > 1) qs.set("page", String(merged.page));
    const query = qs.toString();
    return query ? `/sales/leads?${query}` : "/sales/leads";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
        <p className="text-sm text-muted-foreground">
          Built for capturing mid-conversation, a name and number is enough.
        </p>
      </div>

      <QuickAddLead />

      <form action="/sales/leads" className="flex flex-wrap gap-2">
        <input type="hidden" name="status" value={status} />
        <input type="hidden" name="scope" value={scope} />
        <input
          type="search"
          name="q"
          defaultValue={search}
          placeholder="Search a name, number or interest"
          aria-label="Search leads"
          className="h-11 min-w-48 flex-1 rounded-full border bg-background px-4 text-sm"
        />
        <button
          type="submit"
          className="touch-target rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-[#0f5a91]"
        >
          Search
        </button>
        {search ? (
          <Link
            href={href({ q: "" })}
            className="touch-target inline-flex items-center rounded-full border px-5 text-sm font-medium hover:bg-accent"
          >
            Clear
          </Link>
        ) : null}
      </form>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Whose leads">
        {SCOPES.map((s) => (
          <Link
            key={s}
            href={href({ scope: s })}
            aria-current={scope === s ? "true" : undefined}
            className={cn(
              "touch-target inline-flex items-center rounded-full px-4 text-sm",
              scope === s
                ? "bg-foreground font-medium text-background"
                : "border text-muted-foreground hover:bg-accent"
            )}
          >
            {s === "mine" ? "Mine" : s === "pool" ? "Unclaimed pool" : "Everyone"}
            {s === "pool" && poolWaiting[0]?.n ? (
              <span className="tnum ml-2 rounded-full bg-primary px-2 text-xs text-primary-foreground">
                {poolWaiting[0].n}
              </span>
            ) : null}
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Lead status">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={href({ status: s })}
            aria-current={status === s ? "true" : undefined}
            className={cn(
              "touch-target inline-flex items-center gap-1.5 rounded-full px-4 text-sm",
              status === s
                ? "bg-primary font-medium text-primary-foreground"
                : "border text-muted-foreground hover:bg-accent"
            )}
          >
            {STATUS_LABEL[s]}
            <span className="tnum text-xs opacity-70">{countFor(s)}</span>
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={ContactRound}
          sentence={
            search
              ? `Nothing matches "${search}" in this view. Try the Everyone tab, or a different spelling.`
              : scope === "pool"
                ? "The pool is empty, every web lead has an owner."
                : "No leads here. Web coverage checks and abandoned signups land in the unclaimed pool; add walk-ins with the form above."
          }
        />
      ) : (
        <div className="space-y-2">
          {rows.map((lead) => (
            <div
              key={lead.id}
              className="flex items-center justify-between gap-2 rounded-2xl border bg-card p-4"
            >
              <Link href={`/sales/leads/${lead.id}`} className="min-w-0 flex-1">
                <p className="truncate font-medium hover:text-primary">{lead.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {lead.phone}
                  {lead.interest ? ` · ${lead.interest}` : ""}
                </p>
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className="tnum text-xs text-muted-foreground"
                  title={`Created ${formatDateTime(lead.createdAt)}`}
                >
                  {formatAge(lead.createdAt)}
                </span>
                {!lead.ownerSalesId ? <ClaimButton leadId={lead.id} /> : null}
                <StatusPill status={lead.status} />
              </div>
            </div>
          ))}
        </div>
      )}

      {lastPage > 1 ? (
        <nav
          className="flex items-center justify-between gap-2"
          aria-label="Lead list pages"
        >
          {page > 1 ? (
            <Link
              href={href({ page: page - 1 })}
              className="touch-target inline-flex items-center rounded-full border px-5 text-sm font-medium hover:bg-accent"
            >
              Previous
            </Link>
          ) : (
            <span />
          )}
          <p className="tnum text-xs text-muted-foreground">
            Page {page} of {lastPage}, {total} lead{total === 1 ? "" : "s"}
          </p>
          {page < lastPage ? (
            <Link
              href={href({ page: page + 1 })}
              className="touch-target inline-flex items-center rounded-full border px-5 text-sm font-medium hover:bg-accent"
            >
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
