"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { customers } from "@/lib/db/schema";
import { requireActor } from "@/lib/auth";
import { authorize } from "@/lib/auth/authorize";
import { writeAudit } from "@/lib/domain/audit";
import {
  recordManualPayment,
  voidInvoice,
  writeOffInvoice,
  adjustInvoice,
} from "@/lib/domain/billing";
import { markOrderPaid, provisionPaidOrder } from "@/lib/domain/orders";
import { parseZar } from "@/lib/money";
import {
  suspendService,
  reactivateService,
  adminOverrideCancel,
} from "@/lib/domain/services";

export type Result = { ok: boolean; error?: string };
const fail = (err: unknown): Result => ({
  ok: false,
  error: err instanceof Error ? err.message : "Failed",
});

/**
 * Money off a form is text, never a float. `parseZar` strips R, spaces and
 * thousand separators and throws on anything it cannot read, so a cleared
 * field or a pasted "R1 200,00" is rejected instead of silently booking R0.
 */
function moneyField(form: FormData, field: string, label: string): number {
  const raw = String(form.get(field) ?? "").trim();
  if (!raw) throw new Error(`${label} is required`);
  try {
    return parseZar(raw);
  } catch {
    throw new Error(`${label} is not a valid amount, for example 1200.00`);
  }
}

export async function updateCustomerAction(form: FormData): Promise<Result> {
  try {
    const actor = await requireActor();
    const customerId = String(form.get("customerId"));
    const [before] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1);
    if (!before) throw new Error("Customer not found");
    authorize(actor, "customer.write", {
      customerId,
      assignedSalesId: before.assignedSalesId,
    });

    const patch = {
      firstName: String(form.get("firstName") ?? "") || null,
      lastName: String(form.get("lastName") ?? "") || null,
      companyName: String(form.get("companyName") ?? "") || null,
      email: String(form.get("email") ?? "") || null,
      phone: String(form.get("phone") ?? "") || null,
      vatNumber: String(form.get("vatNumber") ?? "") || null,
    };
    await db.transaction(async (tx) => {
      await tx.update(customers).set(patch).where(eq(customers.id, customerId));
      await writeAudit(tx, {
        actor,
        action: "customer.update",
        entity: "customer",
        entityId: customerId,
        before: {
          firstName: before.firstName,
          lastName: before.lastName,
          companyName: before.companyName,
          email: before.email,
          phone: before.phone,
        },
        after: patch,
      });
    });
    revalidatePath(`/admin/customers/${customerId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function assignRepAction(
  customerId: string,
  repUserId: string | null
): Promise<Result> {
  try {
    const actor = await requireActor();
    authorize(actor, "staff.manage");
    await db.transaction(async (tx) => {
      const [before] = await tx
        .select({ assignedSalesId: customers.assignedSalesId })
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1);
      await tx
        .update(customers)
        .set({ assignedSalesId: repUserId })
        .where(eq(customers.id, customerId));
      await writeAudit(tx, {
        actor,
        action: "customer.assign_rep",
        entity: "customer",
        entityId: customerId,
        before: { assignedSalesId: before?.assignedSalesId },
        after: { assignedSalesId: repUserId },
      });
    });
    revalidatePath(`/admin/customers/${customerId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function saveNotesAction(form: FormData): Promise<Result> {
  try {
    const actor = await requireActor();
    const customerId = String(form.get("customerId"));
    authorize(actor, "customer.write", { customerId });
    await db
      .update(customers)
      .set({ notes: String(form.get("notes") ?? "") || null })
      .where(eq(customers.id, customerId));
    revalidatePath(`/admin/customers/${customerId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function recordEftAction(form: FormData): Promise<Result> {
  try {
    const actor = await requireActor();
    const paidOn = String(form.get("paidOn") ?? "").trim();
    await recordManualPayment(actor, {
      invoiceId: String(form.get("invoiceId")),
      amountCents: moneyField(form, "amount", "Amount"),
      reference: String(form.get("reference") ?? ""),
      paidOn: paidOn || undefined,
    });
    revalidatePath(`/admin/customers/${String(form.get("customerId"))}`);
    revalidatePath("/admin/billing");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function markOrderPaidManuallyAction(
  form: FormData
): Promise<Result> {
  try {
    const actor = await requireActor();
    authorize(actor, "payment.record_manual");
    const orderId = String(form.get("orderId"));
    // The order total is authoritative and travels as integer cents; the
    // form never round-trips it through rands.
    const amountCents = Number(form.get("amountCents"));
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      throw new Error("Order total is missing, reload the page and try again");
    }
    const result = await markOrderPaid({
      orderId,
      gatewayRef: String(form.get("reference") ?? "") || null,
      amountCents,
      method: "eft_manual",
      recordedBy: actor.userId,
    });
    /*
     * Gate on `settled`, not on `!alreadyPaid`. markOrderPaid no longer throws
     * when the captured amount does not cover the order: it banks the money and
     * flags it for an operator. Provisioning an unsettled order would throw
     * "is not paid", so the operator would be told the capture failed for a
     * payment that was in fact recorded correctly.
     *
     * provisionPaidOrder rather than createServicesForPaidOrder, so a
     * provisioning failure becomes an audited event and a bell instead of a
     * raw error string on this form.
     */
    if (result.settled) {
      await provisionPaidOrder(orderId);
    }
    revalidatePath(`/admin/customers/${String(form.get("customerId"))}`);
    revalidatePath("/admin");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Void: the invoice should never have existed. Reason is mandatory. */
export async function voidInvoiceAction(form: FormData): Promise<Result> {
  try {
    const actor = await requireActor();
    await voidInvoice(actor, {
      invoiceId: String(form.get("invoiceId")),
      reason: String(form.get("reason") ?? ""),
    });
    revalidatePath(`/admin/customers/${String(form.get("customerId"))}`);
    revalidatePath("/admin/billing");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Write-off: the debt is real but will not be collected (§6.3 day 40). */
export async function writeOffInvoiceAction(form: FormData): Promise<Result> {
  try {
    const actor = await requireActor();
    await writeOffInvoice(actor, {
      invoiceId: String(form.get("invoiceId")),
      reason: String(form.get("reason") ?? ""),
    });
    revalidatePath(`/admin/customers/${String(form.get("customerId"))}`);
    revalidatePath("/admin/billing");
    revalidatePath("/admin");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Partial credit: appends a negative adjustment line, nothing is deleted. */
export async function creditInvoiceAction(form: FormData): Promise<Result> {
  try {
    const actor = await requireActor();
    await adjustInvoice(actor, {
      invoiceId: String(form.get("invoiceId")),
      amountCents: moneyField(form, "amount", "Credit amount"),
      reason: String(form.get("reason") ?? ""),
    });
    revalidatePath(`/admin/customers/${String(form.get("customerId"))}`);
    revalidatePath("/admin/billing");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function suspendServiceAction(form: FormData): Promise<Result> {
  try {
    const actor = await requireActor();
    const reason = String(form.get("reason") ?? "").trim();
    if (reason.length < 4) {
      throw new Error("Give a reason, it goes on the audit trail");
    }
    await suspendService(actor, String(form.get("serviceId")), reason);
    revalidatePath(`/admin/customers/${String(form.get("customerId"))}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function reactivateServiceAction(
  serviceId: string,
  customerId: string
): Promise<Result> {
  try {
    const actor = await requireActor();
    await reactivateService(actor, serviceId);
    revalidatePath(`/admin/customers/${customerId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function overrideCancelAction(form: FormData): Promise<Result> {
  try {
    const actor = await requireActor();
    await adminOverrideCancel(
      actor,
      String(form.get("serviceId")),
      String(form.get("reason") ?? "")
    );
    revalidatePath(`/admin/customers/${String(form.get("customerId"))}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
