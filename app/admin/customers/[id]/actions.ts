"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { customers } from "@/lib/db/schema";
import { requireActor } from "@/lib/auth";
import { authorize } from "@/lib/auth/authorize";
import { writeAudit } from "@/lib/domain/audit";
import { recordManualPayment } from "@/lib/domain/billing";
import { markOrderPaid } from "@/lib/domain/orders";
import {
  createServicesForPaidOrder,
  suspendService,
  reactivateService,
  adminOverrideCancel,
} from "@/lib/domain/services";

export type Result = { ok: boolean; error?: string };
const fail = (err: unknown): Result => ({
  ok: false,
  error: err instanceof Error ? err.message : "Failed",
});

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
    await recordManualPayment(actor, {
      invoiceId: String(form.get("invoiceId")),
      amountCents: Math.round(Number(form.get("amountRands")) * 100),
      reference: String(form.get("reference") ?? ""),
    });
    revalidatePath(`/admin/customers/${String(form.get("customerId"))}`);
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
    const amountCents = Math.round(Number(form.get("amountRands")) * 100);
    const result = await markOrderPaid({
      orderId,
      gatewayRef: String(form.get("reference") ?? "") || null,
      amountCents,
      method: "eft_manual",
      recordedBy: actor.userId,
    });
    if (!result.alreadyPaid) {
      await createServicesForPaidOrder(orderId);
    }
    revalidatePath(`/admin/customers/${String(form.get("customerId"))}`);
    revalidatePath("/admin");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function suspendServiceAction(
  serviceId: string,
  customerId: string,
  reason: string
): Promise<Result> {
  try {
    const actor = await requireActor();
    await suspendService(actor, serviceId, reason || "Admin manual suspension");
    revalidatePath(`/admin/customers/${customerId}`);
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
