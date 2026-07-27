"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { services } from "@/lib/db/schema";
import { requireActor } from "@/lib/auth";
import { authorize } from "@/lib/auth/authorize";
import { writeAudit } from "@/lib/domain/audit";
import { emitDomainEvent, forwardDomainEvent } from "@/lib/domain/events";
import { changePlan } from "@/lib/domain/billing-engine";
import {
  requestCancellation,
  withdrawCancellation,
} from "@/lib/domain/services";
import { customerFacingError } from "@/app/portal/_lib/errors";

/**
 * Portal service actions.
 *
 * These are the only places a customer moves their own money, so none of them
 * throws: a domain guard, an expired session or a dropped connection comes
 * back as `{ ok: false, error }` and is rendered inline on the confirmation
 * screen. The caller navigates on success, so the customer always lands on a
 * page that states plainly what happened.
 */

export type ServiceActionResult =
  | { ok: true; href: string }
  | { ok: false; error: string };

const changeSchema = z.object({
  serviceId: z.string().uuid(),
  newPlanId: z.string().uuid(),
});

const serviceSchema = z.object({
  serviceId: z.string().uuid(),
  reason: z.string().trim().max(2000).optional(),
});

function revalidateService(serviceId: string) {
  revalidatePath(`/portal/services/${serviceId}`);
  revalidatePath("/portal");
}

export async function changePlanAction(
  input: z.input<typeof changeSchema>
): Promise<ServiceActionResult> {
  try {
    const { serviceId, newPlanId } = changeSchema.parse(input);
    const actor = await requireActor();
    const result = await changePlan(actor, serviceId, newPlanId);
    revalidateService(serviceId);
    if (result.kind === "upgrade") {
      const suffix = result.charged ? "" : `&invoice=${result.invoiceId}`;
      return {
        ok: true,
        href: `/portal/services/${serviceId}?changed=upgrade${suffix}`,
      };
    }
    return {
      ok: true,
      href: `/portal/services/${serviceId}?changed=downgrade&date=${result.effectiveDate}`,
    };
  } catch (err) {
    return { ok: false, error: customerFacingError(err) };
  }
}

export async function cancelServiceAction(
  input: z.input<typeof serviceSchema>
): Promise<ServiceActionResult> {
  try {
    const { serviceId, reason } = serviceSchema.parse(input);
    const actor = await requireActor();
    const { effectiveDate } = await requestCancellation(
      actor,
      serviceId,
      reason?.trim() || "Customer requested"
    );
    revalidateService(serviceId);
    return {
      ok: true,
      href: `/portal/services/${serviceId}?cancelled=${effectiveDate}`,
    };
  } catch (err) {
    return { ok: false, error: customerFacingError(err) };
  }
}

export async function withdrawCancellationAction(
  input: z.input<typeof serviceSchema>
): Promise<ServiceActionResult> {
  try {
    const { serviceId } = serviceSchema.parse(input);
    const actor = await requireActor();
    await withdrawCancellation(actor, serviceId);
    revalidateService(serviceId);
    return { ok: true, href: `/portal/services/${serviceId}?withdrawn=1` };
  } catch (err) {
    return { ok: false, error: customerFacingError(err) };
  }
}

/**
 * Undo a scheduled downgrade. Cancellations already have a withdraw path;
 * without this, a customer who changes their mind about a plan change has no
 * self-service route at all. Clears the two scheduling columns only, so the
 * service keeps its current plan and price; the service status is untouched
 * and stays the state machine's business.
 */
export async function cancelScheduledPlanChangeAction(
  input: z.input<typeof serviceSchema>
): Promise<ServiceActionResult> {
  try {
    const { serviceId } = serviceSchema.parse(input);
    const actor = await requireActor();

    const [scope] = await db
      .select({
        customerId: services.customerId,
        pendingPlanId: services.pendingPlanId,
        planChangeEffectiveDate: services.planChangeEffectiveDate,
      })
      .from(services)
      .where(eq(services.id, serviceId))
      .limit(1);
    if (!scope) throw new Error("Service not found");
    authorize(actor, "service.transition", { customerId: scope.customerId });

    const eventId = await db.transaction(async (tx) => {
      // Guarded update: a concurrent rollover that already applied the change
      // clears these columns, and this then affects no rows.
      const updated = await tx
        .update(services)
        .set({ pendingPlanId: null, planChangeEffectiveDate: null })
        .where(
          and(eq(services.id, serviceId), isNotNull(services.pendingPlanId))
        )
        .returning({ id: services.id });
      if (updated.length === 0) throw new Error("No pending plan change");

      await writeAudit(tx, {
        actor,
        action: "service.plan_change.cancel",
        entity: "service",
        entityId: serviceId,
        before: {
          pendingPlanId: scope.pendingPlanId,
          planChangeEffectiveDate: scope.planChangeEffectiveDate,
        },
        after: { pendingPlanId: null, planChangeEffectiveDate: null },
      });
      return emitDomainEvent(tx, "service.plan_change_cancelled", {
        serviceId,
        customerId: scope.customerId,
        cancelledPlanId: scope.pendingPlanId,
      });
    });

    await forwardDomainEvent(eventId);
    revalidateService(serviceId);
    return {
      ok: true,
      href: `/portal/services/${serviceId}?changeCancelled=1`,
    };
  } catch (err) {
    return { ok: false, error: customerFacingError(err) };
  }
}
