import { NextRequest, NextResponse } from "next/server";
import { currentActor } from "@/lib/auth";
import { authorize } from "@/lib/auth/authorize";
import { reconciliationWorksheet, toCsv } from "@/lib/domain/reports";

/**
 * Reconciliation match (spec §6.4): POST the provider statement CSV
 * (external_ref,amount columns), get back the flagged worksheet as CSV.
 * Nothing is written — this is a checklist the admin resolves.
 */
export async function POST(req: NextRequest) {
  const actor = await currentActor();
  if (!actor) return new NextResponse("Forbidden", { status: 403 });
  try {
    authorize(actor, "billing.reconciliation");
  } catch {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const provider = req.nextUrl.searchParams.get("provider") ?? "";
  const form = await req.formData();
  const file = form.get("statement") as File | null;

  const statement = new Map<string, number>();
  if (file && file.size > 0) {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    for (const [index, line] of lines.entries()) {
      const [ref, amount] = line.split(",").map((s) => s.trim());
      if (index === 0 && /[a-z]/i.test(amount ?? "")) continue; // header row
      if (!ref || !amount) continue;
      const cents = Math.round(parseFloat(amount) * 100);
      if (Number.isFinite(cents)) statement.set(ref, cents);
    }
  }

  const result = await reconciliationWorksheet({
    providerName: provider,
    statement: statement.size > 0 ? statement : undefined,
  });

  const csv = toCsv(
    ["customer", "plan", "external_ref", "expected_cost_rands", "statement_rands", "flag"],
    [
      ...result.rows.map((r) => [
        r.customerName,
        r.planName,
        r.externalRef,
        r.expectedCostCents != null ? (r.expectedCostCents / 100).toFixed(2) : "",
        r.statementCents != null ? (r.statementCents / 100).toFixed(2) : "",
        r.flag,
      ]),
      ...result.leakage.map((l) => [
        "(not on platform)",
        "",
        l.externalRef,
        "",
        (l.statementCents / 100).toFixed(2),
        "leakage",
      ]),
    ]
  );

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="reconciliation-${provider}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
