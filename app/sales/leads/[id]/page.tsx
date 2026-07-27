import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { leads, leadActivities, quotes } from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import { isQuoteExpired } from "@/lib/domain/quotes";
import { formatDate, formatDateTime } from "@/lib/format";
import { StatusPill } from "@/components/shared/status-pill";
import { MoneyText } from "@/components/shared/money-text";
import { BackLink } from "../../back-link";
import { ActivityForm, LeadStatusButtons } from "../client";
import { isUuid } from "@/lib/utils";

export const metadata: Metadata = { title: "Lead" };

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // A malformed id would reach Postgres as an invalid uuid and throw a
  // 500 instead of the 404 the visitor should see.
  if (!isUuid(id)) notFound();
  const actor = await currentActor();
  if (!actor) redirect("/staff-login");

  const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!lead) notFound();
  // Scoping (§12): reps only see their own or unclaimed leads.
  if (
    actor.role !== "admin" &&
    lead.ownerSalesId !== null &&
    lead.ownerSalesId !== actor.userId
  ) {
    notFound();
  }

  const [activities, leadQuotes] = await Promise.all([
    db
      .select()
      .from(leadActivities)
      .where(eq(leadActivities.leadId, id))
      .orderBy(desc(leadActivities.createdAt)),
    db.select().from(quotes).where(eq(quotes.leadId, id)),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <BackLink href="/sales/leads">Leads</BackLink>
        <div className="mt-2 flex items-start justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{lead.name}</h1>
            <p className="text-sm text-muted-foreground">
              <a
                href={`https://wa.me/${lead.phone.replace(/\D/g, "")}`}
                className="text-primary hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                {lead.phone}
              </a>
              {lead.email ? ` · ${lead.email}` : ""}
            </p>
            {lead.interest ? (
              <p className="text-sm text-muted-foreground">{lead.interest}</p>
            ) : null}
            {lead.addressText ? (
              <p className="text-sm text-muted-foreground">{lead.addressText}</p>
            ) : null}
          </div>
          <StatusPill status={lead.status} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/sales/quotes/new?lead=${lead.id}`}
          className="inline-flex touch-target items-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 hover:bg-[#0f5a91]"
        >
          Build a quote
        </Link>
        <LeadStatusButtons leadId={lead.id} status={lead.status} />
      </div>

      {leadQuotes.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Quotes</h2>
          {leadQuotes.map((q) => (
            <Link
              key={q.id}
              href={`/sales/quotes/${q.id}`}
              className="flex items-center justify-between rounded-2xl border bg-card p-3 text-sm hover:border-primary/40"
            >
              <span>
                <span className="font-mono">{q.number}</span>
                {q.expiresAt ? (
                  <span className="block text-xs text-muted-foreground">
                    {isQuoteExpired(q)
                      ? `Expired ${formatDate(q.expiresAt)}`
                      : `Valid until ${formatDate(q.expiresAt)}`}
                  </span>
                ) : null}
              </span>
              <span className="flex items-center gap-2">
                <MoneyText cents={q.totalCents} />
                <StatusPill
                  status={
                    q.status !== "accepted" && isQuoteExpired(q) ? "expired" : q.status
                  }
                />
              </span>
            </Link>
          ))}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Activity</h2>
        <ActivityForm leadId={lead.id} />
        <div className="space-y-2">
          {activities.map((a) => (
            <div key={a.id} className="rounded-2xl border bg-card p-3 text-sm">
              <p className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="font-medium uppercase tracking-wide">
                  {a.kind.replace("_", " ")}
                </span>
                <span className="tnum">{formatDateTime(a.createdAt)}</span>
              </p>
              {a.body ? <p className="mt-1">{a.body}</p> : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
