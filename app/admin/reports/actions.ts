"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/auth";
import { updateSetting } from "@/lib/domain/settings";
import { inviteStaff, setStaffStatus, setStaffRole } from "@/lib/domain/staff";
import { sendEmail } from "@/lib/notify/email";
import { getSmsAdapter } from "@/lib/notify/sms";
import { authorize } from "@/lib/auth/authorize";

export type Result = { ok: boolean; error?: string; detail?: string };
const fail = (err: unknown): Result => ({
  ok: false,
  error: err instanceof Error ? err.message : "Failed",
});

export async function updateCompanyAction(form: FormData): Promise<Result> {
  try {
    const actor = await requireActor();
    await updateSetting(actor, "company", {
      legalName: String(form.get("legalName")),
      website: String(form.get("website")),
      phone: String(form.get("phone")),
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
    const r = await sms.send(to, "Needd Connect test message — SMS channel works.");
    return r.ok
      ? { ok: true, detail: `via ${sms.name}` }
      : { ok: false, error: r.detail };
  } catch (err) {
    return fail(err);
  }
}
