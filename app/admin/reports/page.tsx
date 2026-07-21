import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq, ilike, or } from "drizzle-orm";
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
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  CompanyForm,
  BankingForm,
  InviteStaffForm,
  StaffRow,
  TestSendPanel,
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
          : "disabled — email fallback active",
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
        : "local drivers (dev) — polling fallback",
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
  searchParams: Promise<{ tab?: string; entity?: string; provider?: string }>;
}) {
  const { tab = "reports", entity, provider = "Telkom" } = await searchParams;

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

      {tab === "reports" ? <ReportsTab /> : null}
      {tab === "reconciliation" ? <ReconciliationTab provider={provider} /> : null}
      {tab === "settings" ? <SettingsTab /> : null}
      {tab === "staff" ? <StaffTab /> : null}
      {tab === "integrations" ? (
        <IntegrationsTab items={integrationStatus()} />
      ) : null}
      {tab === "templates" ? <TemplatesTab /> : null}
      {tab === "audit" ? <AuditTab entity={entity} /> : null}
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
                    <td className="p-3">{row.category}</td>
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
                      "—"
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
            Margin is flying blind on these — fill wholesale costs in the
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
        columns to match line items — nothing auto-adjusts; this is a
        checklist you resolve.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {providerRows.map((p) => (
          <Link
            key={p.id}
            href={`/admin/reports?tab=reconciliation&provider=${encodeURIComponent(p.name)}`}
            className={cn(
              "rounded-full px-3 py-1 text-sm",
              provider === p.name
                ? "bg-primary font-medium text-primary-foreground"
                : "border text-muted-foreground hover:bg-accent"
            )}
          >
            {p.name}
          </Link>
        ))}
      </div>

      <form
        method="post"
        action={`/admin/reports/reconcile?provider=${encodeURIComponent(provider)}`}
        encType="multipart/form-data"
        className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3"
      >
        <Input
          type="file"
          name="statement"
          accept=".csv,text/csv"
          className="max-w-xs"
          aria-label="Provider statement CSV"
        />
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Match statement
        </button>
        <span className="text-xs text-muted-foreground">
          Expected wholesale total:{" "}
          <MoneyText cents={worksheet.expectedTotalCents} />
        </span>
      </form>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="p-3 font-medium">Customer</th>
              <th className="p-3 font-medium">Plan</th>
              <th className="p-3 font-medium">External ref</th>
              <th className="p-3 text-right font-medium">Expected cost</th>
              <th className="p-3 font-medium">Flag</th>
            </tr>
          </thead>
          <tbody>
            {worksheet.rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-4 text-center text-muted-foreground">
                  No active services on {provider}.
                </td>
              </tr>
            ) : (
              worksheet.rows.map((row) => (
                <tr key={row.serviceId} className="border-b last:border-0">
                  <td className="p-3">{row.customerName}</td>
                  <td className="p-3">{row.planName}</td>
                  <td className="p-3 font-mono text-xs">
                    {row.externalRef ?? "—"}
                  </td>
                  <td className="p-3 text-right">
                    {row.expectedCostCents != null ? (
                      <MoneyText cents={row.expectedCostCents} />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-3">
                    {row.flag === "ok" ? (
                      <span className="text-xs text-emerald-700">ok</span>
                    ) : (
                      <span className="text-xs font-medium text-amber-700">
                        {row.flag.replace(/_/g, " ")}
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
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

async function AuditTab({ entity }: { entity?: string }) {
  const rows = await db
    .select()
    .from(auditLog)
    .where(
      entity
        ? or(
            eq(auditLog.entity, entity),
            ilike(auditLog.action, `%${entity}%`)
          )
        : undefined
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
        <Link
          href="/admin/reports?tab=audit"
          className={cn(
            "rounded-full px-3 py-1 text-sm",
            !entity
              ? "bg-primary font-medium text-primary-foreground"
              : "border text-muted-foreground hover:bg-accent"
          )}
        >
          All
        </Link>
        {entities.map((e) => (
          <Link
            key={e}
            href={`/admin/reports?tab=audit&entity=${e}`}
            className={cn(
              "rounded-full px-3 py-1 text-sm",
              entity === e
                ? "bg-primary font-medium text-primary-foreground"
                : "border text-muted-foreground hover:bg-accent"
            )}
          >
            {e.replace("_", " ")}
          </Link>
        ))}
      </div>
      <div className="space-y-1.5">
        {rows.map((row) => (
          <details key={row.id} className="rounded-lg border bg-card p-3 text-sm">
            <summary className="flex cursor-pointer items-center justify-between">
              <span className="font-mono text-xs font-medium">{row.action}</span>
              <span className="text-xs text-muted-foreground">
                {row.createdAt.toISOString().replace("T", " ").slice(0, 19)} ·{" "}
                {row.actorRole}
              </span>
            </summary>
            <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
              {row.before ? (
                <div>
                  <p className="font-medium text-muted-foreground">Before</p>
                  <pre className="mt-1 overflow-x-auto rounded bg-muted p-2">
                    {JSON.stringify(row.before, null, 2)}
                  </pre>
                </div>
              ) : null}
              {row.after ? (
                <div>
                  <p className="font-medium text-muted-foreground">After</p>
                  <pre className="mt-1 overflow-x-auto rounded bg-muted p-2">
                    {JSON.stringify(row.after, null, 2)}
                  </pre>
                </div>
              ) : null}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}