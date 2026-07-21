import { NextRequest, NextResponse } from "next/server";
import { currentActor } from "@/lib/auth";
import {
  activeServicesByCategory,
  activeServicesByProvider,
  activationsVsCancellations,
  toCsv,
} from "@/lib/domain/reports";
import { ageAnalysis } from "@/lib/domain/billing-engine";

export async function GET(req: NextRequest) {
  const actor = await currentActor();
  if (!actor || actor.role !== "admin") {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const report = req.nextUrl.searchParams.get("report");
  let csv: string;

  switch (report) {
    case "services-by-category": {
      const rows = await activeServicesByCategory();
      csv = toCsv(
        ["category", "active_services", "mrr_rands"],
        rows.map((r) => [r.category, r.count, (r.mrrCents / 100).toFixed(2)])
      );
      break;
    }
    case "margin-by-provider": {
      const rows = await activeServicesByProvider();
      csv = toCsv(
        ["provider", "active_services", "mrr_rands", "known_margin_rands", "plans_missing_cost"],
        rows.map((r) => [
          r.provider,
          r.count,
          (r.mrrCents / 100).toFixed(2),
          r.marginCents != null ? (r.marginCents / 100).toFixed(2) : "",
          r.missingCost,
        ])
      );
      break;
    }
    case "movement": {
      const rows = await activationsVsCancellations();
      csv = toCsv(
        ["month", "activations", "cancellations"],
        rows.map((r) => [r.month, r.activations, r.cancellations])
      );
      break;
    }
    case "age-analysis": {
      const rows = await ageAnalysis();
      csv = toCsv(
        ["customer", "current_rands", "d30_rands", "d60_rands", "d90_rands", "total_rands"],
        rows.map((r) => [
          r.customerName,
          (r.currentCents / 100).toFixed(2),
          (r.d30Cents / 100).toFixed(2),
          (r.d60Cents / 100).toFixed(2),
          (r.d90Cents / 100).toFixed(2),
          (r.totalCents / 100).toFixed(2),
        ])
      );
      break;
    }
    default:
      return new NextResponse("Unknown report", { status: 400 });
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="needd-${report}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
