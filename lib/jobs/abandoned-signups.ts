import "server-only";
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { signupDrafts } from "@/lib/db/schema";
import { createLead } from "@/lib/domain/leads";
import { recordJobHeartbeat, type JobSource } from "@/lib/domain/ops-health";
import type { SignupDraftState } from "@/lib/domain/signup";

export interface AbandonedSignupResult {
  scanned: number;
  captured: number;
  noPhoneYet: number;
}

/**
 * Abandoned-signup capture (spec 9.2 edge cases): drafts that got past
 * step 2 with contact details but never paid become `web_abandoned` leads.
 * Runs hourly; each draft is captured once.
 *
 * Signup is email-first, but a lead still needs the phone number RICA
 * requires, so drafts abandoned before the number was captured cannot become
 * leads. They are counted rather than silently skipped, so the gap is visible
 * in the run result instead of looking like nobody abandoned.
 *
 * Safe to run twice. The six-hour cutoff makes the candidate set change
 * slowly, and capture stamps `abandonedLeadCaptured` on the draft itself in
 * the same pass, so a second run over the same window skips every draft the
 * first one turned into a lead. The stamp is the real protection; the caller's
 * stand-down guard only saves the wasted scan.
 *
 * No scheduler lives in this file. It is called by `/api/cron/abandoned-signups`
 * and could be called by anything else that wants the same work done.
 */
export async function runAbandonedSignupCapture(
  source: JobSource
): Promise<AbandonedSignupResult> {
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const drafts = await db
    .select()
    .from(signupDrafts)
    .where(
      and(lt(signupDrafts.updatedAt, cutoff), isNotNull(signupDrafts.state))
    )
    .limit(200);

  let captured = 0;
  let noPhoneYet = 0;
  for (const draft of drafts) {
    const state = draft.state as SignupDraftState;
    if (
      !state.contact ||
      state.orderId || // paid or paying, not abandoned
      state.abandonedLeadCaptured ||
      !(state.address || state.planSlug || state.bundleSlug)
    ) {
      continue;
    }
    if (!state.contact.phone) {
      noPhoneYet++;
      continue;
    }
    const interest = [
      state.planSlug ? `plan: ${state.planSlug}` : null,
      state.bundleSlug ? `bundle: ${state.bundleSlug}` : null,
      state.hardware?.length
        ? `hardware: ${state.hardware.map((h) => h.sku).join(", ")}`
        : null,
    ]
      .filter(Boolean)
      .join("; ");
    try {
      await createLead({
        name: state.contact.name,
        phone: state.contact.phone,
        email: state.contact.email ?? null,
        source: "web_abandoned",
        interest: interest || "Abandoned signup",
        addressText: state.address
          ? [state.address.line1, state.address.city].join(", ")
          : null,
      });
      await db
        .update(signupDrafts)
        .set({
          state: { ...state, abandonedLeadCaptured: true } as Record<
            string,
            unknown
          >,
        })
        .where(eq(signupDrafts.id, draft.id));
      captured++;
    } catch (err) {
      console.error(`abandoned-signup capture failed for ${draft.id}:`, err);
    }
  }

  // A quiet hour and a dead scheduler both capture zero leads. The
  // heartbeat is what separates them on the admin readout.
  const result: AbandonedSignupResult = {
    scanned: drafts.length,
    captured,
    noPhoneYet,
  };
  await recordJobHeartbeat("abandoned-signups", source, { ...result });
  return result;
}
