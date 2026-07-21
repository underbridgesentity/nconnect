import { cron } from "inngest";
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "@/lib/db/client";
import { signupDrafts } from "@/lib/db/schema";
import { createLead } from "@/lib/domain/leads";
import type { SignupDraftState } from "@/lib/domain/signup";

/**
 * Abandoned-signup capture (spec §9.2 edge cases): drafts that got past
 * step 2 with contact details but never paid become `web_abandoned` leads.
 * Runs hourly; each draft is captured once.
 */
export const abandonedSignups = inngest.createFunction(
  { id: "abandoned-signups", triggers: [cron("0 * * * *")] },
  async () => {
    const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const drafts = await db
      .select()
      .from(signupDrafts)
      .where(
        and(lt(signupDrafts.updatedAt, cutoff), isNotNull(signupDrafts.state))
      )
      .limit(200);

    let captured = 0;
    for (const draft of drafts) {
      const state = draft.state as SignupDraftState;
      if (
        !state.contact?.phone ||
        state.orderId || // paid or paying, not abandoned
        state.abandonedLeadCaptured ||
        !(state.address || state.planSlug || state.bundleSlug)
      ) {
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
    return { scanned: drafts.length, captured };
  }
);
