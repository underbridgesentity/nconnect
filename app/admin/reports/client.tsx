"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill } from "@/components/shared/status-pill";
import { MoneyText } from "@/components/shared/money-text";
import { FilterPillButton } from "@/components/ui/filter-pill";
import { cn } from "@/lib/utils";
import { RECON_FLAG_LABELS } from "../labels";
import {
  updateCompanyAction,
  updateBankingAction,
  inviteStaffAction,
  staffStatusAction,
  staffRoleAction,
  testSendAction,
  matchStatementAction,
  type Result,
  type ReconResult,
} from "./actions";

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<Result>, success: string) =>
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(success + (r.detail ? ` (${r.detail})` : ""));
        router.refresh();
      } else toast.error(r.error ?? "Failed");
    });
  return { pending, run };
}

export function CompanyForm({ company }: { company: Record<string, string> }) {
  const { pending, run } = useRun();
  const fields: [string, string, string?][] = [
    ["legalName", "Legal name"],
    ["website", "Website"],
    ["phone", "Phone"],
    [
      "whatsapp",
      "WhatsApp number",
      "Must be a real mobile (06x, 07x, 081 to 084). The WhatsApp buttons across the public site stay hidden until this is set, because wa.me cannot deliver to an 086 share-call number.",
    ],
    ["email", "Email"],
    ["vat", "VAT number"],
    ["reg", "Company registration"],
    ["bbbee", "B-BBEE status"],
  ];
  return (
    <form
      className="space-y-3 rounded-lg border bg-card p-4"
      action={(form) => run(() => updateCompanyAction(form), "Company details saved")}
    >
      <h2 className="text-sm font-semibold">Company details</h2>
      {fields.map(([name, label, hint]) => (
        <div key={name} className="space-y-1">
          <Label htmlFor={`company-${name}`} className="text-xs">
            {label}
          </Label>
          <Input
            id={`company-${name}`}
            name={name}
            defaultValue={company[name] ?? ""}
            aria-describedby={hint ? `company-${name}-hint` : undefined}
          />
          {hint ? (
            <p
              id={`company-${name}-hint`}
              className="text-xs leading-5 text-muted-foreground"
            >
              {hint}
            </p>
          ) : null}
        </div>
      ))}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

export function BankingForm({ banking }: { banking: Record<string, string> }) {
  const { pending, run } = useRun();
  const fields: [string, string][] = [
    ["bank", "Bank"],
    ["accountName", "Account name"],
    ["accountNumber", "Account number"],
    ["branchCode", "Branch code"],
  ];
  return (
    <form
      className="space-y-3 rounded-lg border bg-card p-4"
      action={(form) => run(() => updateBankingAction(form), "Banking details saved")}
    >
      <h2 className="text-sm font-semibold">EFT banking details</h2>
      <p className="text-xs text-muted-foreground">
        Shown on unpaid invoice PDFs. Reference is always the invoice number.
      </p>
      {fields.map(([name, label]) => (
        <div key={name} className="space-y-1">
          <Label htmlFor={`bank-${name}`} className="text-xs">
            {label}
          </Label>
          <Input id={`bank-${name}`} name={name} defaultValue={banking[name] ?? ""} />
        </div>
      ))}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

export function InviteStaffForm() {
  const { pending, run } = useRun();
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3"
      action={(form) => run(() => inviteStaffAction(form), "Invitation sent")}
    >
      <div className="min-w-40 flex-1 space-y-1">
        <Label htmlFor="invite-name" className="text-xs">
          Name
        </Label>
        <Input id="invite-name" name="name" required />
      </div>
      <div className="min-w-52 flex-1 space-y-1">
        <Label htmlFor="invite-email" className="text-xs">
          Email
        </Label>
        <Input id="invite-email" name="email" type="email" required />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Role</Label>
        <Select name="role" defaultValue="sales">
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sales">Sales</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Inviting…" : "Invite"}
      </Button>
    </form>
  );
}

export function StaffRow({
  user,
}: {
  user: {
    id: string;
    name: string;
    email: string;
    role: "admin" | "sales";
    status: string;
  };
}) {
  const { pending, run } = useRun();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3">
      <div>
        <p className="text-sm font-medium">{user.name}</p>
        <p className="text-xs text-muted-foreground">{user.email}</p>
      </div>
      <div className="flex items-center gap-2">
        <Select
          value={user.role}
          onValueChange={(v) =>
            run(() => staffRoleAction(user.id, v as "admin" | "sales"), "Role updated")
          }
          disabled={pending}
        >
          <SelectTrigger className="w-24" aria-label="Role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sales">Sales</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
        <StatusPill status={user.status} />
        {user.status === "disabled" ? (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              run(() => staffStatusAction(user.id, "active"), "Re-enabled")
            }
          >
            Enable
          </Button>
        ) : (
          <Button
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() =>
              run(() => staffStatusAction(user.id, "disabled"), "Disabled")
            }
          >
            Disable
          </Button>
        )}
      </div>
    </div>
  );
}

export function TestSendPanel() {
  const { pending, run } = useRun();
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [to, setTo] = useState("");
  return (
    <div className="rounded-lg border bg-card p-3">
      <h2 className="text-sm font-semibold">Test send</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Select value={channel} onValueChange={(v) => setChannel(v as "email")}>
          <SelectTrigger className="w-28" aria-label="Channel">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="email">Email</SelectItem>
            <SelectItem value="sms">SMS</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder={channel === "email" ? "you@needd.co.za" : "0821234567"}
          className="w-56"
          aria-label="Recipient"
        />
        <Button
          size="sm"
          disabled={pending || !to}
          onClick={() => run(() => testSendAction(channel, to), "Test sent")}
        >
          {pending ? "Sending…" : "Send test"}
        </Button>
      </div>
    </div>
  );
}

/** Export exactly what is on screen, no second upload round trip. */
function downloadReconCsv(provider: string, result: ReconResult): void {
  const escape = (value: string | number) =>
    /[",\n]/.test(String(value))
      ? `"${String(value).replace(/"/g, '""')}"`
      : String(value);
  const rands = (cents: number) => (cents / 100).toFixed(2);
  const lines = [
    ["customer", "plan", "external_ref", "expected_rands", "statement_rands", "flag"],
    ...result.rows.map((r) => [
      r.customerName,
      r.planName,
      r.externalRef ?? "",
      r.expectedCostCents != null ? rands(r.expectedCostCents) : "",
      r.statementCents != null ? rands(r.statementCents) : "",
      r.flag,
    ]),
    ...result.leakage.map((l) => [
      "(not on platform)",
      "",
      l.externalRef,
      "",
      rands(l.statementCents),
      "leakage",
    ]),
    ...result.unreadable.map((u) => [
      `(could not read line ${u.line})`,
      u.text,
      "",
      "",
      "",
      "unreadable",
    ]),
  ];
  const blob = new Blob([lines.map((r) => r.map(escape).join(",")).join("\n")], {
    type: "text/csv",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `reconciliation-${provider}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Statement matching, rendered in place. The monthly wholesale check is the
 * platform's margin-protection ritual, so the answer belongs on screen with
 * a summary, a flagged-only default and the leakage rows called out. The
 * CSV is still there as an explicit export.
 */
export function ReconcileWorksheet({
  provider,
  expectedTotalCents,
}: {
  provider: string;
  expectedTotalCents: number;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ReconResult | null>(null);
  const [flaggedOnly, setFlaggedOnly] = useState(true);

  const visible = result
    ? result.rows.filter((r) => (flaggedOnly ? r.flag !== "ok" : true))
    : [];
  const flaggedCount = result
    ? result.rows.filter((r) => r.flag !== "ok").length
    : 0;
  const deltaCents = result
    ? result.statementTotalCents - result.expectedTotalCents
    : 0;

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3"
        action={(form) =>
          startTransition(async () => {
            form.set("provider", provider);
            const r = await matchStatementAction(form);
            if (!r.ok) {
              toast.error(r.error);
              return;
            }
            setResult(r.result);
            if (r.result.unreadable.length > 0) {
              toast.warning(
                `Matched, but ${r.result.unreadable.length} line${r.result.unreadable.length === 1 ? "" : "s"} could not be read.`
              );
            } else {
              toast.success("Statement matched");
            }
          })
        }
      >
        <Input
          type="file"
          name="statement"
          accept=".csv,text/csv"
          required
          className="max-w-xs"
          aria-label="Provider statement CSV"
        />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Matching…" : "Match statement"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Expected wholesale total: <MoneyText cents={expectedTotalCents} />
        </span>
      </form>

      {result ? (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ["Expected wholesale", result.expectedTotalCents, false],
              ["Statement total", result.statementTotalCents, false],
              ["Difference", deltaCents, true],
            ].map(([label, cents, highlight]) => (
              <div
                key={String(label)}
                className="rounded-lg border bg-card p-3"
              >
                <p className="text-xs text-muted-foreground">{String(label)}</p>
                <MoneyText
                  cents={Number(cents)}
                  className={cn(
                    "text-lg font-semibold",
                    highlight && Number(cents) !== 0 && "text-red-600"
                  )}
                />
              </div>
            ))}
            <div className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">Flagged lines</p>
              <p
                className={cn(
                  "tnum text-lg font-semibold",
                  flaggedCount > 0 && "text-amber-700"
                )}
              >
                {flaggedCount} of {result.rows.length}
              </p>
            </div>
          </div>

          {result.unreadable.length > 0 ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">
                Could not read {result.unreadable.length} line
                {result.unreadable.length === 1 ? "" : "s"}, they were left out
                of the match.
              </p>
              <ul className="mt-1 space-y-0.5 font-mono text-xs">
                {result.unreadable.slice(0, 5).map((u) => (
                  <li key={u.line}>
                    Line {u.line}: {u.text.slice(0, 90)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {[
              [true, `Flagged only (${flaggedCount})`],
              [false, `Every line (${result.rows.length})`],
            ].map(([value, label]) => (
              <FilterPillButton
                key={String(label)}
                onClick={() => setFlaggedOnly(Boolean(value))}
                active={flaggedOnly === value}
              >
                {String(label)}
              </FilterPillButton>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => downloadReconCsv(provider, result)}
            >
              Export CSV
            </Button>
          </div>

          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b bg-card text-left text-xs text-muted-foreground">
                  <th className="p-3 font-medium">Customer</th>
                  <th className="p-3 font-medium">Plan</th>
                  <th className="p-3 font-medium">External ref</th>
                  <th className="p-3 text-right font-medium">Expected</th>
                  <th className="p-3 text-right font-medium">On statement</th>
                  <th className="p-3 text-right font-medium">Difference</th>
                  <th className="p-3 font-medium">Flag</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="p-4 text-center text-muted-foreground"
                    >
                      {flaggedOnly
                        ? "Every line matches the statement."
                        : `No active services on ${provider}.`}
                    </td>
                  </tr>
                ) : (
                  visible.map((row) => {
                    const delta =
                      row.statementCents != null && row.expectedCostCents != null
                        ? row.statementCents - row.expectedCostCents
                        : null;
                    return (
                      <tr key={row.serviceId} className="border-b last:border-0">
                        <td className="p-3">{row.customerName}</td>
                        <td className="p-3">{row.planName}</td>
                        <td className="p-3 font-mono text-xs">
                          {row.externalRef ?? "not linked"}
                        </td>
                        <td className="p-3 text-right">
                          {row.expectedCostCents != null ? (
                            <MoneyText cents={row.expectedCostCents} />
                          ) : (
                            <span className="text-muted-foreground">not set</span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          {row.statementCents != null ? (
                            <MoneyText cents={row.statementCents} />
                          ) : (
                            <span className="text-muted-foreground">absent</span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          {delta != null && delta !== 0 ? (
                            <MoneyText
                              cents={delta}
                              className="font-medium text-red-600"
                            />
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="p-3">
                          <span
                            className={cn(
                              "text-xs",
                              row.flag === "ok"
                                ? "text-emerald-700"
                                : "font-medium text-amber-700"
                            )}
                          >
                            {RECON_FLAG_LABELS[row.flag] ?? row.flag}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {visible.length > 0 ? (
                <tfoot>
                  <tr className="border-t bg-muted/40 font-medium">
                    <td className="p-3" colSpan={3}>
                      Totals, {visible.length} line
                      {visible.length === 1 ? "" : "s"} shown
                    </td>
                    <td className="p-3 text-right">
                      <MoneyText
                        cents={visible.reduce(
                          (sum, r) => sum + (r.expectedCostCents ?? 0),
                          0
                        )}
                      />
                    </td>
                    <td className="p-3 text-right">
                      <MoneyText
                        cents={visible.reduce(
                          (sum, r) => sum + (r.statementCents ?? 0),
                          0
                        )}
                      />
                    </td>
                    <td className="p-3" colSpan={2} />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>

          {result.leakage.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-red-600">
                Billed by the provider, not on the platform ({result.leakage.length})
              </h3>
              <p className="text-xs text-muted-foreground">
                These references are on the statement but have no active
                service behind them. Every one is wholesale cost with no
                revenue against it.
              </p>
              <div className="overflow-x-auto rounded-lg border bg-card">
                <table className="w-full min-w-[360px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="p-3 font-medium">External ref</th>
                      <th className="p-3 text-right font-medium">
                        Charged on statement
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.leakage.map((l) => (
                      <tr key={l.externalRef} className="border-b last:border-0">
                        <td className="p-3 font-mono text-xs">{l.externalRef}</td>
                        <td className="p-3 text-right">
                          <MoneyText cents={l.statementCents} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-muted/40 font-medium">
                      <td className="p-3">Total leakage</td>
                      <td className="p-3 text-right">
                        <MoneyText
                          cents={result.leakage.reduce(
                            (sum, l) => sum + l.statementCents,
                            0
                          )}
                          className="text-red-600"
                        />
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
