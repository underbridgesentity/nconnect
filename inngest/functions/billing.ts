import { cron } from "inngest";
import { inngest } from "../client";
import {
  runInvoiceGeneration,
  runDunning,
  runCancellationSweep,
} from "@/lib/domain/billing-engine";
import { todayInJohannesburg } from "@/lib/domain/services";
import { recordJobHeartbeat, type JobSource } from "@/lib/domain/ops-health";

export interface NightlyBillingResult {
  today: string;
  invoicesIssued: number;
  dunningProcessed: number;
  dunningFailed: number;
  cancellationsFinalized: number;
}

/**
 * The nightly billing sequence itself, with no scheduler attached.
 *
 * It lives apart from the Inngest wrapper because it has two callers: the
 * Inngest cron below, and `/api/cron/billing`, the Vercel Cron backstop that
 * exists so the month-two invoice still goes out on a night when Inngest is
 * misconfigured. One definition, so the backstop cannot drift into doing
 * something subtly different from the primary path.
 *
 * Order matters (spec §6.1): invoice generation, then dunning, then the
 * cancellation sweep, so a just-issued invoice is never dunned on day 0 and a
 * service only cancels after its final period is settled.
 */
export async function runNightlyBilling(
  source: JobSource,
  today = todayInJohannesburg()
): Promise<NightlyBillingResult> {
  const invoices = await runInvoiceGeneration(today);
  const dunning = await runDunning(today);
  const cancellationsFinalized = await runCancellationSweep(today);

  const result: NightlyBillingResult = {
    today,
    invoicesIssued: invoices.length,
    dunningProcessed: dunning.processed,
    // Per-invoice failures are swallowed inside the sweep so one bad row
    // cannot stop the rest. Surfacing the count is what makes them visible
    // rather than leaving them only in the logs.
    dunningFailed: dunning.failed,
    cancellationsFinalized,
  };

  await recordJobHeartbeat("billing-run", source, { ...result });
  return result;
}

/**
 * The daily billing run (spec §6.1): 02:00 Africa/Johannesburg (= 00:00 UTC).
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

    const result: NightlyBillingResult = {
      today,
      invoicesIssued,
      dunningProcessed: dunning.processed,
      dunningFailed: dunning.failed,
      cancellationsFinalized,
    };

    // Its own step so a heartbeat write that fails is retried rather than
    // silently leaving the admin readout claiming billing never ran on a night
    // when it did. Also the marker `/api/cron/billing` checks before deciding
    // whether the backstop has any work to do.
    await step.run("record-heartbeat", async () => {
      await recordJobHeartbeat("billing-run", "inngest", { ...result });
      return result;
    });

    return result;
  }
);
