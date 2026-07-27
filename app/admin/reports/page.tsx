import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { Download } from "lucide-react";
import { db } from "@/lib/db/client";
import { users, auditLog, providers } from "@/lib/db/schema";
import {
  activeServicesByCategory,
  activeServicesByProvider,
  activationsVsCancellations,
  missingCostChecklist,
  collectionsSummary,
  reconciliationWorksheet,
} from "@/lib/domain/reports";
import { getSetting, getSettingOr } from "@/lib/domain/settings";
import { DEFAULT_DUNNING } from "@/lib/domain/billing-engine";
import { TEMPLATES } from "@/lib/notify/templates";
import { MoneyText } from "@/components/shared/money-text";
import { FilterPillLink } from "@/components/ui/filter-pill";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format";
import { actorLabel, planCategoryLabel } from "../labels";
import { TableSkeleton } from "../skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  CompanyForm,
  BankingForm,
  InviteStaffForm,
  StaffRow,
  TestSendPanel,
  ReconcileWorksheet,
} from "./client";

export const metadata: Metadata = { title: "Reports & Settings" };

const TABS = [
  { key: "reports", label: "Reports" },
  { key: "reconciliation", label: "Reconciliation" },
  { key: "settings", label: "Settings" },
  { key: "staff", label: "Staff" },
  { key: "integrations", label: "Integrations" },
  { key: "templates", label: "Templates" },
  { key: "audit", label: "Audit log" },
];

function integrationStatus() {
  return [
    {
      name: "PayFast",
      state: process.env.PAYFAST_MERCHANT_ID
        ? process.env.PAYFAST_MODE === "live"
          ? "live"
          : "sandbox"
        : "not configured",
    },
    {
      name: "WhatsApp (Meta Cloud API)",
      state:
        process.env.WHATSAPP_ENABLED === "true"
          ? "live"
          : "disabled, email fallback active",
    },
    {
      name: "Resend (email)",
      state: process.env.RESEND_API_KEY ? "configured" : "console driver (dev)",
    },
    {
      name: `SMS (${process.env.SMS_PROVIDER ?? "console"})`,
      state:
        (process.env.SMS_PROVIDER ?? "console") === "console"
          ? "console driver (dev)"
          : process.env.SMS_API_KEY
            ? "configured"
            : "missing API key",
    },
    {
      name: "Supabase (storage + realtime)",
      state: process.env.SUPABASE_URL
        ? "configured"
        : "local drivers (dev), polling fallback",
    },
    {
      name: "Inngest",
      state: process.env.INNGEST_EVENT_KEY ? "configured" : "dev mode",
    },
  ];
}

export default async function ReportsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    entity?: string;
    provider?: string;
    q?: string;
  }>;
}) {
  const { tab = "reports", entity, provider = "Telkom", q } = await searchParams;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Reports &amp; Settings
        </h1>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin/reports?tab=${t.key}`}
            className={cn(
              "touch-target flex shrink-0 items-center border-b-2 px-3 text-sm font-medium",
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {/*
        Only the tab body waits. The Reports tab alone runs five aggregate
        queries and the reconciliation worksheet is slower still, so without
        this the heading and the tab strip were held back by whichever tab
        happened to be open. Keyed on the tab so switching tabs shows the
        skeleton rather than freezing on the previous tab's numbers, which
        would read as "the click did nothing".
      */}
      <Suspense key={tab} fallback={<TabBodySkeleton tab={tab} />}>
        {tab === "reports" ? <ReportsTab /> : null}
        {tab === "reconciliation" ? (
          <ReconciliationTab provider={provider} />
        ) : null}
        {tab === "settings" ? <SettingsTab /> : null}
        {tab === "staff" ? <StaffTab /> : null}
        {tab === "integrations" ? (
          <IntegrationsTab items={integrationStatus()} />
        ) : null}
        {tab === "templates" ? <TemplatesTab /> : null}
        {tab === "audit" ? <AuditTab entity={entity} q={q} /> : null}
      </Suspense>
    </div>
  );
}

/**
 * Fallback for the tab body. The settings-shaped tabs are stacked forms and
 * the rest are tables, so it picks between two shapes rather than flashing a
 * table where a form is about to land.
 */
function TabBodySkeleton({ tab }: { tab: string }) {
  const isForm = tab === "settings" || tab === "templates" || tab === "integrations";
  return (
    <div className="space-y-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      {isForm ? (
        [0, 1].map((i) => (
          <section key={i} className="space-y-3 rounded-lg border bg-card p-4">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-8 w-full max-w-md rounded-lg pointer-coarse:h-11" />
            <Skeleton className="h-8 w-full max-w-md rounded-lg pointer-coarse:h-11" />
            <Skeleton className="h-8 w-28 rounded-full" />
          </section>
        ))
      ) : (
        <>
          <section className="space-y-2">
            <Skeleton className="h-4 w-56 max-w-full" />
            <TableSkeleton columns={3} rows={5} />
          </section>
          <section className="space-y-2">
            <Skeleton className="h-4 w-64 max-w-full" />
            <TableSkeleton columns={4} rows={4} />
          </section>
        </>
      )}
    </div>
  );
}

async function ReportsTab() {
  const [byCategory, byProvider, movement, missingCost, collections] =
    await Promise.all([
      activeServicesByCategory(),
      activeServicesByProvider(),
      activationsVsCancellations(),
      missingCostChecklist(),
      collectionsSummary(),
    ]);

  const exportLink = (report: string) => (
    <a
      href={`/admin/reports/export?report=${report}`}
      className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
    >
      <Download className="size-3" aria-hidden /> CSV
    </a>
  );

  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Active services by category</h2>
          {exportLink("services-by-category")}
        </div>
        <div className="mt-2 overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="p-3 font-medium">Category</th>
                <th className="p-3 text-right font-medium">Active</th>
                <th className="p-3 text-right font-medium">MRR</th>
              </tr>
            </thead>
            <tbody>
              {byCategory.length === 0 ? (
                <tr>
                  <td colSpan={3} className="p-4 text-center text-muted-foreground">
                    No active services yet.
                  </td>
                </tr>
              ) : (
                byCategory.map((row) => (
                  <tr key={row.category} className="border-b last:border-0">
                    <td className="p-3">{planCategoryLabel(row.category)}</td>
                    <td className="tnum p-3 text-right">{row.count}</td>
                    <td className="p-3 text-right">
                      <MoneyText cents={row.mrrCents} whole />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            Margin by provider (active services)
          </h2>
          {exportLink("margin-by-provider")}
        </div>
        <div className="mt-2 overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="p-3 font-medium">Provider</th>
                <th className="p-3 text-right font-medium">Active</th>
                <th className="p-3 text-right font-medium">MRR</th>
                <th className="p-3 text-right font-medium">Known margin</th>
                <th className="p-3 text-right font-medium">Missing cost</th>
              </tr>
            </thead>
            <tbody>
              {byProvider.map((row) => (
                <tr key={row.provider} className="border-b last:border-0">
                  <td className="p-3">{row.provider}</td>
                  <td className="tnum p-3 text-right">{row.count}</td>
                  <td className="p-3 text-right">
                    <MoneyText cents={row.mrrCents} whole />
                  </td>
                  <td className="p-3 text-right">
                    {row.marginCents != null ? (
                      <MoneyText cents={row.marginCents} whole />
                    ) : (
                      <span className="text-muted-foreground">not set</span>
                    )}
                  </td>
                  <td
                    className={cn(
                      "tnum p-3 text-right",
                      row.missingCost > 0 && "font-medium text-amber-700"
                    )}
                  >
                    {row.missingCost}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold">Activations vs cancellations</h2>
        <div className="mt-2 overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[360px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="p-3 font-medium">Month</th>
                <th className="p-3 text-right font-medium">Activations</th>
                <th className="p-3 text-right font-medium">Cancellations</th>
              </tr>
            </thead>
            <tbody>
              {movement.length === 0 ? (
                <tr>
                  <td colSpan={3} className="p-4 text-center text-muted-foreground">
                    Movement appears as services activate and cancel.
                  </td>
                </tr>
              ) : (
                movement.map((row) => (
                  <tr key={row.month} className="border-b last:border-0">
                    <td className="tnum p-3">{row.month}</td>
                    <td className="tnum p-3 text-right">{row.activations}</td>
                    <td className="tnum p-3 text-right">{row.cancellations}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold">Collections</h2>
        <div className="mt-2 grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Open</p>
            <p>
              {collections.openCount} · <MoneyText cents={collections.openCents} />
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Past due</p>
            <p className={cn(collections.pastDueCents > 0 && "text-red-600")}>
              {collections.pastDueCount} ·{" "}
              <MoneyText cents={collections.pastDueCents} />
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Collected this month</p>
            <p>
              <MoneyText cents={collections.paidThisMonthCents} />
            </p>
          </div>
        </div>
        <Link
          href="/admin/billing?tab=age"
          className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
        >
          Full age analysis →
        </Link>
      </section>

      {missingCost.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold text-amber-700">
            Set cost prices ({missingCost.length} plans)
          </h2>
          <p className="text-xs text-muted-foreground">
            Margin is flying blind on these, fill wholesale costs in the
            Catalogue.
          </p>
          <div className="mt-2 space-y-1">
            {missingCost.map((row) => (
              <Link
                key={row.planName}
                href="/admin/catalogue"
                className="flex items-center justify-between rounded-md border bg-card p-2 text-sm hover:border-primary/40"
              >
                <span>
                  {row.planName}{" "}
                  <span className="text-xs text-muted-foreground">
                    ({row.provider})
                  </span>
                </span>
                <span className="tnum text-xs text-muted-foreground">
                  {row.activeServices} active
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

async function ReconciliationTab({ provider }: { provider: string }) {
  const providerRows = await db.select().from(providers).orderBy(providers.name);
  const worksheet = await reconciliationWorksheet({ providerName: provider });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Monthly wholesale check (spec §6.4): platform-active services vs the
        provider statement. Upload a CSV with <code>external_ref,amount</code>{" "}
        columns to match line items, nothing auto-adjusts; this is a
        checklist you resolve.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {providerRows.map((p) => (
          <FilterPillLink
            key={p.id}
            href={`/admin/reports?tab=reconciliation&provider=${encodeURIComponent(p.name)}`}
            active={provider === p.name}
          >
            {p.name}
          </FilterPillLink>
        ))}
      </div>

      <ReconcileWorksheet
        provider={provider}
        expectedTotalCents={worksheet.expectedTotalCents}
      />

      {worksheet.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No active services on {provider} to reconcile.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {worksheet.rows.length} active service
          {worksheet.rows.length === 1 ? "" : "s"} on {provider} are in scope
          for this month.
        </p>
      )}
    </div>
  );
}

async function SettingsTab() {
  const [company, banking, dunning] = await Promise.all([
    getSetting<Record<string, string>>("company"),
    getSetting<Record<string, string>>("banking"),
    getSettingOr("dunning", DEFAULT_DUNNING),
  ]);
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <CompanyForm company={company ?? {}} />
      <BankingForm banking={banking ?? {}} />
      <div className="rounded-lg border bg-card p-4 md:col-span-2">
        <h2 className="text-sm font-semibold">Dunning timeline</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Charge attempts on days {dunning.chargeAttemptDays.join(", ")} · past
          due +{dunning.pastDueDay} · suspend +{dunning.suspendDay} · admin
          decision +{dunning.adminDecisionDay}. Stored in settings; contact the
          developers to change the schedule safely.
        </p>
      </div>
    </div>
  );
}

async function StaffTab() {
  const staff = await db
    .select()
    .from(users)
    .where(or(eq(users.role, "admin"), eq(users.role, "sales")))
    .orderBy(users.name);
  return (
    <div className="space-y-4">
      <InviteStaffForm />
      <div className="space-y-2">
        {staff.map((member) => (
          <StaffRow
            key={member.id}
            user={{
              id: member.id,
              name: member.name,
              email: member.email ?? "",
              role: member.role as "admin" | "sales",
              status: member.status,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function IntegrationsTab({
  items,
}: {
  items: { name: string; state: string }[];
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.name}
            className="flex items-center justify-between rounded-lg border bg-card p-3 text-sm"
          >
            <span className="font-medium">{item.name}</span>
            <span
              className={cn(
                "text-xs",
                item.state.includes("live") || item.state === "configured"
                  ? "text-emerald-700"
                  : "text-amber-700"
              )}
            >
              {item.state}
            </span>
          </div>
        ))}
      </div>
      <TestSendPanel />
    </div>
  );
}

function TemplatesTab() {
  const rendered = Object.entries(TEMPLATES).map(([event, template]) => ({
    event,
    whatsapp: template.whatsappTemplate,
    sample: template.render({
      reference: "INV-2026-00042",
      amountCents: 66400,
      serviceName: "Telkom Uncapped LTE Plus",
      link: "https://needdconnect.co.za/pay/…",
      extra: { effectiveDate: "2026-08-18", outcome: "available", message: "Fibre is live at your address." },
    }),
  }));
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Notification copy as customers receive it (sample values). WhatsApp
        template names must match the approved Meta templates.
      </p>
      {rendered.map((t) => (
        <details key={t.event} className="rounded-lg border bg-card p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            {t.event}
            {t.whatsapp ? (
              <span className="ml-2 font-mono text-xs text-muted-foreground">
                wa: {t.whatsapp}
              </span>
            ) : null}
          </summary>
          <p className="mt-2 font-medium">{t.sample.subject}</p>
          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
            {t.sample.text}
          </p>
        </details>
      ))}
    </div>
  );
}

async function AuditTab({ entity, q }: { entity?: string; q?: string }) {
  const search = q?.trim();
  // Join the user behind actor_user_id: an audit trail that cannot name the
  // actor fails the compliance purpose it exists for (§12, POPIA).
  const rows = await db
    .select({ entry: auditLog, actorName: users.name })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.actorUserId, users.id))
    .where(
      and(
        entity
          ? or(eq(auditLog.entity, entity), ilike(auditLog.action, `%${entity}%`))
          : undefined,
        search
          ? or(
              ilike(auditLog.entityId, `%${search}%`),
              ilike(auditLog.action, `%${search}%`),
              ilike(users.name, `%${search}%`)
            )
          : undefined
      )
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(100);

  const entities = [
    "service",
    "invoice",
    "order",
    "customer",
    "plan",
    "quote",
    "lead",
    "rica_record",
    "conversation",
    "user",
    "setting",
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        <FilterPillLink href="/admin/reports?tab=audit" active={!entity}>
          All
        </FilterPillLink>
        {entities.map((e) => (
          <FilterPillLink
            key={e}
            href={`/admin/reports?tab=audit&entity=${e}`}
            active={entity === e}
          >
            {e.replace("_", " ")}
          </FilterPillLink>
        ))}
      </div>

      <form method="get" action="/admin/reports" className="flex gap-2">
        <input type="hidden" name="tab" value="audit" />
        {entity ? <input type="hidden" name="entity" value={entity} /> : null}
        <Input
          name="q"
          defaultValue={search}
          placeholder="Search by record id, action or who did it…"
          className="max-w-md"
          aria-label="Search the audit log"
        />
      </form>

      <div className="space-y-1.5">
        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {search
              ? `Nothing in the audit log matches "${search}".`
              : "No audited actions recorded yet."}
          </p>
        ) : (
          rows.map(({ entry, actorName }) => (
            <details
              key={entry.id}
              className="rounded-lg border bg-card p-3 text-sm"
            >
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs font-medium">
                  {entry.action}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(entry.createdAt)} ·{" "}
                  {actorLabel(actorName, entry.actorRole)}
                </span>
              </summary>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {entry.entity} {entry.entityId}
              </p>
              <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
                {entry.before ? (
                  <div>
                    <p className="font-medium text-muted-foreground">Before</p>
                    <pre className="mt-1 overflow-x-auto rounded bg-muted p-2">
                      {JSON.stringify(entry.before, null, 2)}
                    </pre>
                  </div>
                ) : null}
                {entry.after ? (
                  <div>
                    <p className="font-medium text-muted-foreground">After</p>
                    <pre className="mt-1 overflow-x-auto rounded bg-muted p-2">
                      {JSON.stringify(entry.after, null, 2)}
                    </pre>
                  </div>
                ) : null}
              </div>
            </details>
          ))
        )}
        {rows.length === 100 ? (
          <p className="pt-1 text-xs text-muted-foreground">
            Showing the 100 most recent entries. Narrow the search to reach
            older ones.
          </p>
        ) : null}
      </div>
    </div>
  );
}