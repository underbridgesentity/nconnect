import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq, isNull, or } from "drizzle-orm";
import { ContactRound } from "lucide-react";
import { db } from "@/lib/db/client";
import { leads } from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import { StatusPill } from "@/components/shared/status-pill";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";
import { QuickAddLead, ClaimButton } from "./client";

export const metadata: Metadata = { title: "Leads" };

const STATUSES = ["all", "new", "contacted", "quoted", "won", "lost"] as const;

export default async function SalesLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status = "all" } = await searchParams;
  const actor = await currentActor();
  if (!actor) redirect("/staff-login");

  // Own leads + unclaimed web leads (claimable). Admin sees all.
  const rows = await db
    .select()
    .from(leads)
    .where(
      actor.role === "admin"
        ? status === "all"
          ? undefined
          : eq(leads.status, status as "new")
        : status === "all"
          ? or(eq(leads.ownerSalesId, actor.userId), isNull(leads.ownerSalesId))
          : or(eq(leads.ownerSalesId, actor.userId), isNull(leads.ownerSalesId))
    )
    .orderBy(desc(leads.createdAt))
    .limit(100);

  const filtered =
    status === "all" ? rows : rows.filter((l) => l.status === status);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
        <p className="text-sm text-muted-foreground">
          Built for capturing mid-conversation, a name and number is enough.
        </p>
      </div>

      <QuickAddLead />

      <div className="flex flex-wrap gap-1.5">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/sales/leads?status=${s}`}
            className={cn(
              "rounded-full px-3 py-1 text-sm capitalize",
              status === s
                ? "bg-primary font-medium text-primary-foreground"
                : "border text-muted-foreground hover:bg-accent"
            )}
          >
            {s}
          </Link>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={ContactRound}
          sentence="No leads here. Web coverage checks and abandoned signups land automatically; add walk-ins with the form above."
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((lead) => (
            <div
              key={lead.id}
              className="flex items-center justify-between gap-2 rounded-lg border bg-card p-4"
            >
              <Link href={`/sales/leads/${lead.id}`} className="min-w-0 flex-1">
                <p className="truncate font-medium hover:text-primary">
                  {lead.name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {lead.phone}
                  {lead.interest ? ` · ${lead.interest}` : ""}
                </p>
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                {!lead.ownerSalesId ? <ClaimButton leadId={lead.id} /> : null}
                <StatusPill status={lead.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
