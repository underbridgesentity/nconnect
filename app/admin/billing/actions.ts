"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { domainEvents, invoices, notifications } from "@/lib/db/schema";
import { requireActor } from "@/lib/auth";
import { authorize } from "@/lib/auth/authorize";
import { writeAudit } from "@/lib/domain/audit";
import { emitDomainEvent, forwardDomainEvent } from "@/lib/domain/events";
import {
  ALLOCATION_RESOLVED_EVENT,
  UNALLOCATED_EVENT,
} from "@/lib/domain/reports";

export type Result = { ok: boolean; error?: string };
const fail = (err: unknown): Result => ({
  ok: false,
  error: err instanceof Error ? err.message : "Failed",
});

/**
 * Close out one unallocated payment.
 *
 * This moves no money. The rand is already banked against the invoice it
 * arrived for, and financial rows are never rewritten (§16.4), so what an
 * operator does here is record the decision they took outside the system:
 * refunded through PayFast, or applied to another invoice as an EFT. The
 * outcome is a note in the audit trail against the same invoice, an event on
 * the outbox, and the exception leaving the queue.
 *
 * `payment.record_manual` is the gate because deciding where received money
 * belongs is the same authority as recording money in the first place, and it
 * is admin-only.
 */
const resolveSchema = z.object({
  /** The payment's identity: `payments.gateway_ref` is unique. */
  gatewayRef: z.string().trim().min(1, "A gateway reference is required").max(200),
  invoiceId: z.string().uuid(),
  outcome: z.enum(["allocated", "refunded"]),
  note: z
    .string()
    .trim()
    .min(4, "Say where the money went, in at least 4 characters")
    .max(500),
});

export async function resolveUnallocatedPaymentAction(
  form: FormData
): Promise<Result> {
  try {
    const actor = await requireActor();
    const input = resolveSchema.parse({
      gatewayRef: String(form.get("gatewayRef") ?? ""),
      invoiceId: String(form.get("invoiceId") ?? ""),
      outcome: String(form.get("outcome") ?? ""),
      note: String(form.get("note") ?? ""),
    });
    authorize(actor, "payment.record_manual");

    const eventId = await db.transaction(async (tx) => {
      const [invoice] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, input.invoiceId))
        .limit(1);
      if (!invoice) throw new Error("Invoice not found");

      // Row lock on the exception itself: two operators working the same
      // queue must not both read "unresolved" and both write a resolution.
      const [exception] = await tx
        .select({ id: domainEvents.id, payload: domainEvents.payload })
        .from(domainEvents)
        .where(
          and(
            eq(domainEvents.name, UNALLOCATED_EVENT),
            sql`${domainEvents.payload}->>'gatewayRef' = ${input.gatewayRef}`
          )
        )
        .limit(1)
        .for("update");
      if (!exception) {
        throw new Error("That payment is not on the unallocated queue");
      }
      const [alreadyResolved] = await tx
        .select({ id: domainEvents.id })
        .from(domainEvents)
        .where(
          and(
            eq(domainEvents.name, ALLOCATION_RESOLVED_EVENT),
            sql`${domainEvents.payload}->>'gatewayRef' = ${input.gatewayRef}`
          )
        )
        .limit(1);
      if (alreadyResolved) {
        throw new Error("Somebody has already dealt with this payment");
      }

      const unallocatedCents = Number(exception.payload.unallocatedCents ?? 0);
      await writeAudit(tx, {
        actor,
        action: "payment.allocation_resolved",
        entity: "invoice",
        entityId: invoice.id,
        before: { gatewayRef: input.gatewayRef, unallocatedCents },
        after: {
          gatewayRef: input.gatewayRef,
          unallocatedCents,
          outcome: input.outcome,
          note: input.note,
        },
      });

      // The bell round 4 rang for this payment is the same signal, so it stops
      // ringing for everyone the moment one person deals with it.
      await tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.type, `payment_unallocated:${input.gatewayRef}`),
            isNull(notifications.readAt)
          )
        );

      return emitDomainEvent(tx, ALLOCATION_RESOLVED_EVENT, {
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        gatewayRef: input.gatewayRef,
        unallocatedCents,
        outcome: input.outcome,
        note: input.note,
      });
    });

    await forwardDomainEvent(eventId);
    revalidatePath("/admin/billing");
    revalidatePath("/admin");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
