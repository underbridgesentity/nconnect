import { cron } from "inngest";
import { inngest } from "../client";
import {
  runInvoiceGeneration,
  runDunning,
  runCancellationSweep,
} from "@/lib/domain/billing-engine";
import { todayInJohannesburg } from "@/lib/domain/services";

/**
 * The daily billing run (spec §6.1): 02:00 Africa/Johannesburg (= 00:00 UTC).
 * Invoice generation, then dunning, then the cancellation sweep, in that
 * order so a just-issued invoice never dunned on day 0 twice and services
 * cancel only after their final period is settled.
 */
export const billingRun = inngest.createFunction(
  { id: "billing-run", triggers: [cron("0 0 * * *")] },
  async () => {
    const today = todayInJohannesburg();
    const invoices = await runInvoiceGeneration(today);
    const dunning = await runDunning(today);
    const cancelled = await runCancellationSweep(today);
    return {
      today,
      invoicesIssued: invoices.length,
      dunningProcessed: dunning.processed,
      cancellationsFinalized: cancelled,
    };
  }
);
