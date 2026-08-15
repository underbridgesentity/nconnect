import "server-only";
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
 * It lives in `lib/jobs` rather than beside the route that calls it so that
 * the scheduling mechanism owns no business logic. Schedulers get replaced,
 * and this one already has been: the run used to be an Inngest function, and
 * moving it here means the next change of mechanism is a change of caller
 * rather than a rewrite of the billing sequence.
 *
 * Order matters (spec 6.1): invoice generation, then dunning, then the
 * cancellation sweep, so a just-issued invoice is never dunned on day 0 and a
 * service only cancels after its final period is settled.
 *
 * Each stage is internally idempotent, which is what makes a repeat call safe:
 * invoice generation locks the service row and re-reads its pointer, dunning
 * keys on the attempt slot, and the cancellation sweep only sees services
 * still in pending_cancellation. The caller adds a stand-down guard on top of
 * that so a repeat is normally not even attempted.
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
