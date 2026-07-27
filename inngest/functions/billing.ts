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
 * order so a just-issued invoice is never dunned twice on day 0 and services
 * cancel only after their final period is settled.
 *
 * Each stage is its own step.run, so a stage that throws is retried and
 * reported on its own rather than taking the rest of the night's billing with
 * it. Ordering still holds because the steps are awaited in sequence, and each
 * stage is internally idempotent (invoice generation locks the service row and
 * re-reads its pointer; dunning keys on the attempt slot), so a step retry
 * cannot double-bill or double-charge.
 */
export const billingRun = inngest.createFunction(
  { id: "billing-run", triggers: [cron("0 0 * * *")] },
  async ({ step }) => {
    const today = todayInJohannesburg();

    const invoicesIssued = await step.run("invoice-generation", async () => {
      const invoices = await runInvoiceGeneration(today);
      return invoices.length;
    });

    const dunning = await step.run("dunning", () => runDunning(today));

    const cancellationsFinalized = await step.run("cancellation-sweep", () =>
      runCancellationSweep(today)
    );

    return {
      today,
      invoicesIssued,
      dunningProcessed: dunning.processed,
      // Per-invoice failures are swallowed inside the sweep so one bad row
      // cannot stop the rest. Surfacing the count here is what makes them
      // visible in the Inngest run rather than only in the logs.
      dunningFailed: dunning.failed,
      cancellationsFinalized,
    };
  }
);
