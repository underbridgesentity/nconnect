import { NextRequest, NextResponse } from "next/server";
import { currentActor } from "@/lib/auth";
import { authorize } from "@/lib/auth/authorize";
import {
  parseStatementCsv,
  reconciliationWorksheet,
  toCsv,
} from "@/lib/domain/reports";
import { todayInJohannesburg } from "@/lib/domain/services";

/**
 * Reconciliation export (spec §6.4): POST the provider statement CSV
 * (external_ref,amount columns), get the flagged worksheet back as CSV.
 * Nothing is written, this is a checklist the admin resolves. The result is
 * also rendered on screen; this route is the Export button behind it.
 *
 * Amounts go through `parseStatementCsv`, which reads both South African
 * number conventions in integer cents. Lines it cannot read are listed at
 * the bottom of the file rather than silently dropped.
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

  let statement: Map<string, number> | undefined;
  let unreadable: { line: number; text: string }[] = [];
  if (file && file.size > 0) {
    const parsed = parseStatementCsv(await file.text());
    unreadable = parsed.unreadable;
    if (parsed.amounts.size > 0) statement = parsed.amounts;
  }

  const result = await reconciliationWorksheet({
    providerName: provider,
    statement,
  });

  const centsToRands = (cents: number) => (cents / 100).toFixed(2);

  const csv = toCsv(
    [
      "customer",
      "plan",
      "external_ref",
      "expected_cost_rands",
      "statement_rands",
      "flag",
    ],
    [
      ...result.rows.map((r) => [
        r.customerName,
        r.planName,
        r.externalRef,
        r.expectedCostCents != null ? centsToRands(r.expectedCostCents) : "",
        r.statementCents != null ? centsToRands(r.statementCents) : "",
        r.flag,
      ]),
      ...result.leakage.map((l) => [
        "(not on platform)",
        "",
        l.externalRef,
        "",
        centsToRands(l.statementCents),
        "leakage",
      ]),
      ...unreadable.map((u) => [
        `(could not read line ${u.line})`,
        u.text,
        "",
        "",
        "",
        "unreadable",
      ]),
    ]
  );

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="reconciliation-${provider}-${todayInJohannesburg()}.csv"`,
    },
  });
}
