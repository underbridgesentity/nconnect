"use server";

import { redirect } from "next/navigation";
import { createLead } from "@/lib/domain/leads";
import { classifyLeadError } from "@/lib/domain/signup";

/**
 * Coverage check (spec §7 ManualConnector.checkCoverage):
 * - LTE/5G: an honest statement of what we can and cannot know from here,
 *   plus the policy if the signal turns out weak once installed.
 * - Fibre: the truth, we confirm within one business day. Creates a lead;
 *   the feasibility provisioning task joins it in M3.
 * Progressive enhancement: plain form POST + redirect, no JS required.
 */
export async function coverageCheckAction(formData: FormData): Promise<void> {
  const kind = String(formData.get("kind") ?? "lte");
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const line1 = String(formData.get("line1") ?? "").trim();
  const suburb = String(formData.get("suburb") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const postalCode = String(formData.get("postalCode") ?? "").trim();

  const addressText = [line1, suburb, city, postalCode]
    .filter(Boolean)
    .join(", ");

  if (kind === "fibre") {
    if (!name || !phone || !addressText) {
      redirect("/coverage?kind=fibre&result=missing");
    }
    try {
      await createLead({
        name,
        phone,
        source: "web_coverage",
        interest: "Fibre feasibility check",
        addressText,
        feasibilityTask: true,
      });
    } catch (err) {
      const reason = classifyLeadError(err);
      if (reason === "system") {
        console.error("coverage fibre lead capture failed:", err);
      }
      redirect(`/coverage?kind=fibre&result=${reason}`);
    }
    redirect("/coverage?result=fibre-promised");
  }

  // LTE/5G: we answer from network footprint, not from a measurement at the
  // door. Capture an optional lead if contact details were given, never
  // require them for the answer.
  let leadFailed = false;
  if (name && phone) {
    try {
      await createLead({
        name,
        phone,
        source: "web_coverage",
        interest: "LTE/5G coverage check",
        addressText: addressText || null,
      });
    } catch (err) {
      // The answer is not gated on the lead, but a silent swallow hides an
      // outage and loses a prospect, so we say so and log it.
      leadFailed = true;
      if (classifyLeadError(err) === "system") {
        console.error("coverage lte lead capture failed:", err);
      }
    }
  }
  const suffix = [
    suburb ? `suburb=${encodeURIComponent(suburb)}` : null,
    leadFailed ? "callback=failed" : null,
  ]
    .filter(Boolean)
    .join("&");
  redirect(`/coverage?result=lte-available${suffix ? `&${suffix}` : ""}`);
}
