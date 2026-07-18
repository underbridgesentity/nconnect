"use server";

import { redirect } from "next/navigation";
import { createLead } from "@/lib/domain/leads";

/**
 * Coverage check (spec §7 ManualConnector.checkCoverage):
 * - LTE/5G: instant "available" with the honest network disclaimer.
 * - Fibre: the truth — we confirm within one business day. Creates a lead;
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
      redirect("/coverage?result=missing");
    }
    try {
      await createLead({
        name,
        phone,
        source: "web_coverage",
        interest: "Fibre feasibility check",
        addressText,
      });
    } catch {
      redirect("/coverage?result=invalid-phone");
    }
    redirect("/coverage?result=fibre-promised");
  }

  // LTE/5G: available with disclaimer. Capture an optional lead if contact
  // details were provided — never require them for an instant answer.
  if (name && phone) {
    try {
      await createLead({
        name,
        phone,
        source: "web_coverage",
        interest: "LTE/5G coverage check",
        addressText: addressText || null,
      });
    } catch {
      // Invalid phone on an optional capture: still give the answer.
    }
  }
  redirect("/coverage?result=lte-available");
}
