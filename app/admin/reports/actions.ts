"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/auth";
import { updateSetting } from "@/lib/domain/settings";
import { inviteStaff, setStaffStatus, setStaffRole } from "@/lib/domain/staff";
import { sendEmail } from "@/lib/notify/email";
import { getSmsAdapter } from "@/lib/notify/sms";
import { authorize } from "@/lib/auth/authorize";
import {
  parseStatementCsv,
  reconciliationWorksheet,
  type ReconRow,
} from "@/lib/domain/reports";

export type Result = { ok: boolean; error?: string; detail?: string };
const fail = (err: unknown): Result => ({
  ok: false,
  error: err instanceof Error ? err.message : "Failed",
});

export interface ReconResult {
  rows: ReconRow[];
  leakage: { externalRef: string; statementCents: number }[];
  expectedTotalCents: number;
  statementTotalCents: number;
  matchedCount: number;
  unreadable: { line: number; text: string }[];
}

/**
 * Match a provider statement and hand the worksheet back to the screen.
 * The monthly margin check used to end in a CSV download, so the moment of
 * value happened in Excel and never in the product (§6.4).
 */
export async function matchStatementAction(
  form: FormData
): Promise<
  { ok: true; result: ReconResult } | { ok: false; error: string }
> {
  try {
    const actor = await requireActor();
    authorize(actor, "billing.reconciliation");
    const provider = String(form.get("provider") ?? "");
    const file = form.get("statement");
    if (!(file instanceof File) || file.size === 0) {
      throw new Error("Choose a statement CSV first");
    }
    const parsed = parseStatementCsv(await file.text());
    if (parsed.amounts.size === 0) {
      throw new Error(
        "No readable lines in that file. It needs external_ref and amount columns."
      );
    }
    const worksheet = await reconciliationWorksheet({
      providerName: provider,
      statement: parsed.amounts,
    });
    let statementTotalCents = 0;
    for (const cents of parsed.amounts.values()) statementTotalCents += cents;

    return {
      ok: true,
      result: {
        ...worksheet,
        statementTotalCents,
        matchedCount: worksheet.rows.filter((r) => r.statementCents != null)
          .length,
        unreadable: parsed.unreadable,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed",
    };
  }
}

export async function updateCompanyAction(form: FormData): Promise<Result> {
  try {
    const actor = await requireActor();
    await updateSetting(actor, "company", {
      legalName: String(form.get("legalName")),
      website: String(form.get("website")),
      phone: String(form.get("phone")),
      whatsapp: String(form.get("whatsapp") ?? ""),
      email: String(form.get("email")),
      vat: String(form.get("vat")),
      reg: String(form.get("reg")),
      bbbee: String(form.get("bbbee")),
    });
    revalidatePath("/admin/reports");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function updateBankingAction(form: FormData): Promise<Result> {
  try {
    const actor = await requireActor();
    await updateSetting(actor, "banking", {
      bank: String(form.get("bank")),
      accountName: String(form.get("accountName")),
      accountNumber: String(form.get("accountNumber")),
      branchCode: String(form.get("branchCode")),
      reference: "Your invoice number",
    });
    revalidatePath("/admin/reports");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function inviteStaffAction(form: FormData): Promise<Result> {
  try {
    const actor = await requireActor();
    await inviteStaff(actor, {
      email: String(form.get("email")),
      name: String(form.get("name")),
      role: String(form.get("role")) as "admin" | "sales",
    });
    revalidatePath("/admin/reports");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function staffStatusAction(
  userId: string,
  status: "active" | "disabled"
): Promise<Result> {
  try {
    const actor = await requireActor();
    await setStaffStatus(actor, userId, status);
    revalidatePath("/admin/reports");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function staffRoleAction(
  userId: string,
  role: "admin" | "sales"
): Promise<Result> {
  try {
    const actor = await requireActor();
    await setStaffRole(actor, userId, role);
    revalidatePath("/admin/reports");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Integrations test-send (§9.4.6): proves the channel end to end. */
export async function testSendAction(
  channel: "email" | "sms",
  to: string
): Promise<Result> {
  try {
    const actor = await requireActor();
    authorize(actor, "settings.write");
    if (channel === "email") {
      const r = await sendEmail({
        to,
        subject: "Needd Connect test message",
        html: "<p>This is a test from the integrations panel. If you're reading it, email works.</p>",
        text: "This is a test from the integrations panel.",
      });
      return r.ok ? { ok: true } : { ok: false, error: r.detail };
    }
    const sms = getSmsAdapter();
    const r = await sms.send(to, "Needd Connect test message, SMS channel works.");
    return r.ok
      ? { ok: true, detail: `via ${sms.name}` }
      : { ok: false, error: r.detail };
  } catch (err) {
    return fail(err);
  }
}
