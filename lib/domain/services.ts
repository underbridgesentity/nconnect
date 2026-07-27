import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, type Tx } from "@/lib/db/client";
import {
  services,
  plans,
  providers,
  orders,
  orderItems,
  bundleItems,
  provisioningTasks,
  providerAccounts,
  sims,
  ricaRecords,
  customers,
  type ChecklistItem,
} from "@/lib/db/schema";
import { authorize, type Actor } from "@/lib/auth/authorize";
import { writeAudit } from "./audit";
import { emitDomainEvent, forwardDomainEvent } from "./events";
import { getConnector, type ServiceContext } from "@/lib/connectors";
import { notify } from "@/lib/notify";
import { absoluteUrl } from "@/lib/config";

/**
 * Service lifecycle state machine (spec §5), the ONLY path for status
 * changes. Direct status writes anywhere else are a bug. Every transition:
 * authorised, transactional, audited, event-emitting.
 */

export type ServiceStatus =
  | "pending"
  | "provisioning"
  | "active"
  | "suspended"
  | "pending_cancellation"
  | "cancelled";

const SIM_CATEGORIES = ["lte_home", "telkom_lte", "sim_data"] as const;

// ------------------------------------------------------------- date helpers

/** Clamp an activation day-of-month to 1..28 so every month works (§5/§6). */
export function clampAnchorDay(day: number): number {
  return Math.min(Math.max(day, 1), 28);
}

/** date string (YYYY-MM-DD) + one month, on the clamped anchor day. */
export function nextMonthOnAnchor(fromDate: string, anchorDay: number): string {
  const [y, m] = fromDate.split("-").map(Number);
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(
    clampAnchorDay(anchorDay)
  ).padStart(2, "0")}`;
}

export function todayInJohannesburg(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
  }).format(new Date());
}

// -------------------------------------------------------------- helpers

async function serviceContext(
  tx: Tx,
  serviceId: string
): Promise<ServiceContext> {
  const [row] = await tx
    .select({
      serviceId: services.id,
      customerId: services.customerId,
      planId: services.planId,
      planName: plans.name,
      category: plans.category,
      providerName: providers.name,
    })
    .from(services)
    .innerJoin(plans, eq(services.planId, plans.id))
    .innerJoin(providers, eq(plans.providerId, providers.id))
    .where(eq(services.id, serviceId))
    .limit(1);
  if (!row) throw new Error("Service not found");
  return row as ServiceContext;
}

async function setStatus(
  tx: Tx,
  actor: Actor | null,
  serviceId: string,
  from: ServiceStatus | ServiceStatus[],
  to: ServiceStatus,
  extra: Partial<typeof services.$inferInsert> = {},
  auditExtra: Record<string, unknown> = {}
): Promise<typeof services.$inferSelect> {
  const [current] = await tx
    .select()
    .from(services)
    .where(eq(services.id, serviceId))
    .limit(1);
  if (!current) throw new Error("Service not found");
  const fromList = Array.isArray(from) ? from : [from];
  if (!fromList.includes(current.status as ServiceStatus)) {
    throw new Error(
      `Invalid transition: ${current.status} -> ${to} (expected from ${fromList.join("/")})`
    );
  }
  const [updated] = await tx
    .update(services)
    .set({ status: to, ...extra })
    .where(eq(services.id, serviceId))
    .returning();
  await writeAudit(tx, {
    actor,
    action: `service.${to}`,
    entity: "service",
    entityId: serviceId,
    before: { status: current.status },
    after: { status: to, ...auditExtra },
  });
  await emitDomainEvent(tx, "service.transitioned", {
    serviceId,
    from: current.status,
    to,
    customerId: current.customerId,
  });
  return updated;
}

// ----------------------------------------- creation from a paid order (§5)

/**
 * Create `pending` service rows for every plan in a paid order (including
 * plans inside bundles), link pending RICA records, then immediately start
 * provisioning for each (pending -> provisioning + connector.activate()).
 * Called after markOrderPaid commits.
 */
export async function createServicesForPaidOrder(
  orderId: string
): Promise<string[]> {
  const eventIds: string[] = [];
  const created = await db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!order) throw new Error("Order not found");
    if (order.status !== "paid") {
      throw new Error(`Order ${order.number} is not paid`);
    }

    // Idempotency: services already created for this order?
    const existing = await tx
      .select({ id: services.id })
      .from(services)
      .where(eq(services.originOrderId, orderId));
    if (existing.length > 0) return [];

    const items = await tx
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    const planIds: string[] = [];
    for (const item of items) {
      if (item.itemType === "plan" && item.planId) planIds.push(item.planId);
      if (item.itemType === "bundle" && item.bundleId) {
        const parts = await tx
          .select()
          .from(bundleItems)
          .where(eq(bundleItems.bundleId, item.bundleId));
        for (const part of parts) {
          if (part.planId) planIds.push(part.planId);
        }
      }
    }
    if (planIds.length === 0) return [];

    const planRows = await tx
      .select()
      .from(plans)
      .where(inArray(plans.id, planIds));

    const createdIds: string[] = [];
    for (const planId of planIds) {
      const plan = planRows.find((p) => p.id === planId)!;
      const [service] = await tx
        .insert(services)
        .values({
          customerId: order.customerId,
          planId,
          originOrderId: orderId,
          addressId: order.addressId,
          status: "pending",
        })
        .returning({ id: services.id });
      createdIds.push(service.id);

      await writeAudit(tx, {
        actor: null,
        action: "service.pending",
        entity: "service",
        entityId: service.id,
        after: { planId, orderId, customerId: order.customerId },
      });

      // Link the RICA record captured at signup to the first SIM service.
      if ((SIM_CATEGORIES as readonly string[]).includes(plan.category)) {
        const [pendingRica] = await tx
          .select({ id: ricaRecords.id })
          .from(ricaRecords)
          .where(
            and(
              eq(ricaRecords.customerId, order.customerId),
              isNull(ricaRecords.serviceId)
            )
          )
          .limit(1);
        if (pendingRica) {
          await tx
            .update(ricaRecords)
            .set({ serviceId: service.id })
            .where(eq(ricaRecords.id, pendingRica.id));
        }
      }
    }
    return createdIds;
  });

  // pending -> provisioning, automatic and immediate (§5).
  for (const serviceId of created) {
    await startProvisioning(serviceId);
  }
  for (const id of eventIds) await forwardDomainEvent(id);
  return created;
}

/** pending -> provisioning: connector activate() creates the task (§5). */
export async function startProvisioning(serviceId: string): Promise<void> {
  const ctx = await db.transaction(async (tx) => {
    const context = await serviceContext(tx, serviceId);
    await setStatus(tx, null, serviceId, "pending", "provisioning");
    return context;
  });
  await getConnector(ctx.providerName).activate(ctx);
  await notify("service_provisioning", {
    customerId: ctx.customerId,
    serviceName: ctx.planName,
  });
}

// -------------------------------------------------- task completion (staff)

export class RicaNotVerifiedError extends Error {
  constructor() {
    super(
      "RICA is not verified for this customer, verify (or reject) the RICA record before activating a SIM service."
    );
    this.name = "RicaNotVerifiedError";
  }
}

/**
 * Staff complete a provisioning task (spec §5, §9.4.1): records external
 * refs / SIM, then advances the state machine per task type. The RICA gate
 * blocks SIM activations without a verified record (§13).
 */
export async function completeProvisioningTask(
  actor: Actor,
  input: {
    taskId: string;
    resultNotes?: string;
    externalRef?: string;
    msisdn?: string;
    circuitId?: string;
    simIccid?: string;
  }
): Promise<{ advancedTo?: ServiceStatus }> {
  authorize(actor, "service.transition");

  const outcome = await db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(provisioningTasks)
      .where(eq(provisioningTasks.id, input.taskId))
      .limit(1);
    if (!task) throw new Error("Task not found");
    if (task.status === "done") return { advancedTo: undefined };
    if (!task.serviceId) {
      throw new Error("Feasibility tasks are closed from the lead, not here");
    }

    const ctx = await serviceContext(tx, task.serviceId);
    const isSim = (SIM_CATEGORIES as readonly string[]).includes(ctx.category);

    // RICA gate (spec §13): activation of SIM services requires verified RICA.
    if (task.type === "activate" && isSim) {
      const [verified] = await tx
        .select({ id: ricaRecords.id })
        .from(ricaRecords)
        .where(
          and(
            eq(ricaRecords.customerId, ctx.customerId),
            eq(ricaRecords.status, "verified")
          )
        )
        .limit(1);
      if (!verified) throw new RicaNotVerifiedError();
    }

    // Record provider account / SIM details where given.
    if (input.externalRef) {
      await tx.insert(providerAccounts).values({
        providerId: (
          await tx
            .select({ id: providers.id })
            .from(providers)
            .innerJoin(plans, eq(plans.providerId, providers.id))
            .where(eq(plans.id, ctx.planId))
            .limit(1)
        )[0].id,
        customerId: ctx.customerId,
        serviceId: ctx.serviceId,
        externalRef: input.externalRef,
        msisdn: input.msisdn ?? null,
        circuitId: input.circuitId ?? null,
      });
    }
    if (input.simIccid) {
      const [existingSim] = await tx
        .select()
        .from(sims)
        .where(eq(sims.iccid, input.simIccid))
        .limit(1);
      if (existingSim) {
        await tx
          .update(sims)
          .set({
            status: "active",
            serviceId: ctx.serviceId,
            msisdn: input.msisdn ?? existingSim.msisdn,
          })
          .where(eq(sims.id, existingSim.id));
      } else {
        await tx.insert(sims).values({
          iccid: input.simIccid,
          msisdn: input.msisdn ?? null,
          network:
            ctx.providerName.toLowerCase() === "vodacom"
              ? "vodacom"
              : ctx.providerName.toLowerCase() === "telkom"
                ? "telkom"
                : "mtn",
          status: "active",
          serviceId: ctx.serviceId,
        });
      }
      await tx
        .update(services)
        .set({
          simId: (
            await tx
              .select({ id: sims.id })
              .from(sims)
              .where(eq(sims.iccid, input.simIccid))
              .limit(1)
          )[0].id,
        })
        .where(eq(services.id, ctx.serviceId));
    }

    const doneChecklist: ChecklistItem[] = task.checklist.map((c) => ({
      ...c,
      done: true,
    }));
    await tx
      .update(provisioningTasks)
      .set({
        status: "done",
        checklist: doneChecklist,
        resultNotes: input.resultNotes ?? null,
        completedBy: actor.userId,
        completedAt: new Date(),
      })
      .where(eq(provisioningTasks.id, task.id));
    await writeAudit(tx, {
      actor,
      action: `provisioning.${task.type}.complete`,
      entity: "provisioning_task",
      entityId: task.id,
      after: {
        serviceId: ctx.serviceId,
        externalRef: input.externalRef,
        notes: input.resultNotes,
      },
    });

    // Advance the state machine per task type (§5).
    let advancedTo: ServiceStatus | undefined;
    if (task.type === "activate") {
      const today = todayInJohannesburg();
      const day = clampAnchorDay(Number(today.split("-")[2]));
      await setStatus(tx, actor, ctx.serviceId, "provisioning", "active", {
        activationDate: today,
        billingAnchorDay: day,
        nextInvoiceDate: nextMonthOnAnchor(today, day),
      });
      advancedTo = "active";

      // Goodwill visibility (§6.1): activation >14 days after payment.
      const [order] = await tx
        .select()
        .from(orders)
        .innerJoin(services, eq(services.originOrderId, orders.id))
        .where(eq(services.id, ctx.serviceId))
        .limit(1);
      if (order?.orders.paidAt) {
        const daysSincePaid =
          (Date.now() - order.orders.paidAt.getTime()) / 86_400_000;
        if (daysSincePaid > 14) {
          await writeAudit(tx, {
            actor: null,
            action: "service.goodwill_note",
            entity: "service",
            entityId: ctx.serviceId,
            after: {
              note: `Activation took ${Math.round(daysSincePaid)} days after payment, consider a goodwill gesture.`,
            },
          });
        }
      }
    } else if (task.type === "reactivate") {
      advancedTo = "active";
      // Status was already set when the payment settled; task closure is
      // the provider-side confirmation. Send the reactivated notification.
    } else if (task.type === "cancel") {
      advancedTo = "cancelled";
      // SIM cleanup on final cancellation.
      await tx
        .update(sims)
        .set({ status: "deactivated" })
        .where(eq(sims.serviceId, ctx.serviceId));
    }

    return { advancedTo, ctx, taskType: task.type };
  });

  // Post-commit notifications.
  if (outcome.advancedTo && "ctx" in outcome && outcome.ctx) {
    const { ctx, taskType } = outcome as {
      ctx: ServiceContext;
      taskType: string;
      advancedTo: ServiceStatus;
    };
    if (taskType === "activate") {
      await notify("service_activated", {
        customerId: ctx.customerId,
        serviceName: ctx.planName,
        link: absoluteUrl("/portal"),
      });
    } else if (taskType === "reactivate") {
      await notify("service_reactivated", {
        customerId: ctx.customerId,
        serviceName: ctx.planName,
      });
    }
  }
  return { advancedTo: outcome.advancedTo };
}

/** Toggle a single checklist item on an open task (inline in Today, §9.4.1). */
export async function toggleChecklistItem(
  actor: Actor,
  taskId: string,
  index: number,
  done: boolean
): Promise<void> {
  authorize(actor, "service.transition");
  await db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(provisioningTasks)
      .where(eq(provisioningTasks.id, taskId))
      .limit(1);
    if (!task || task.status === "done") return;
    const checklist = [...task.checklist];
    if (!checklist[index]) return;
    checklist[index] = { ...checklist[index], done };
    await tx
      .update(provisioningTasks)
      .set({ checklist, status: "in_progress" })
      .where(eq(provisioningTasks.id, taskId));
  });
}

// ------------------------------------------------------- other transitions

/** active -> suspended (dunning engine or admin manual with reason, §5). */
export async function suspendService(
  actor: Actor | null,
  serviceId: string,
  reason: string
): Promise<void> {
  if (actor) authorize(actor, "service.transition");
  const ctx = await db.transaction(async (tx) => {
    const context = await serviceContext(tx, serviceId);
    await setStatus(
      tx,
      actor,
      serviceId,
      "active",
      "suspended",
      { suspendedAt: new Date() },
      { reason }
    );
    return context;
  });
  await getConnector(ctx.providerName).suspend(ctx);
}

/** suspended -> active (qualifying payment settles, or admin manual, §5). */
export async function reactivateService(
  actor: Actor | null,
  serviceId: string
): Promise<void> {
  if (actor) authorize(actor, "service.transition");
  const ctx = await db.transaction(async (tx) => {
    const context = await serviceContext(tx, serviceId);
    await setStatus(tx, actor, serviceId, "suspended", "active", {
      suspendedAt: null,
    });
    return context;
  });
  await getConnector(ctx.providerName).reactivate(ctx);
}

/** active -> pending_cancellation (customer request or admin schedule, §5). */
export async function requestCancellation(
  actor: Actor,
  serviceId: string,
  reason: string
): Promise<{ effectiveDate: string }> {
  const scope = await db
    .select({ customerId: services.customerId })
    .from(services)
    .where(eq(services.id, serviceId))
    .limit(1);
  authorize(actor, "service.transition", {
    customerId: scope[0]?.customerId,
  });

  const result = await db.transaction(async (tx) => {
    const [service] = await tx
      .select()
      .from(services)
      .where(eq(services.id, serviceId))
      .limit(1);
    if (!service) throw new Error("Service not found");
    // End of the current billing period = next invoice date (§5).
    const effectiveDate =
      service.nextInvoiceDate ?? todayInJohannesburg();
    const ctx = await serviceContext(tx, serviceId);
    await setStatus(
      tx,
      actor,
      serviceId,
      "active",
      "pending_cancellation",
      { cancelReason: reason, cancelEffectiveDate: effectiveDate },
      { reason, effectiveDate }
    );
    return { effectiveDate, ctx };
  });

  await notify("cancellation_scheduled", {
    customerId: result.ctx.customerId,
    serviceName: result.ctx.planName,
    link: absoluteUrl("/portal"),
    extra: { effectiveDate: result.effectiveDate },
  });
  return { effectiveDate: result.effectiveDate };
}

/** pending_cancellation -> active (withdrawn before effective date, §5). */
export async function withdrawCancellation(
  actor: Actor,
  serviceId: string
): Promise<void> {
  const scope = await db
    .select({ customerId: services.customerId })
    .from(services)
    .where(eq(services.id, serviceId))
    .limit(1);
  authorize(actor, "service.transition", { customerId: scope[0]?.customerId });
  await db.transaction(async (tx) => {
    await setStatus(tx, actor, serviceId, "pending_cancellation", "active", {
      cancelReason: null,
      cancelEffectiveDate: null,
    });
  });
}

/** pending_cancellation -> cancelled (Inngest on effective date, §5). */
export async function finalizeCancellation(serviceId: string): Promise<void> {
  const ctx = await db.transaction(async (tx) => {
    const context = await serviceContext(tx, serviceId);
    await setStatus(tx, null, serviceId, "pending_cancellation", "cancelled", {
      nextInvoiceDate: null,
    });
    return context;
  });
  await getConnector(ctx.providerName).cancel(ctx);
  await notify("service_cancelled", {
    customerId: ctx.customerId,
    serviceName: ctx.planName,
  });
}

/** any -> cancelled: admin override with mandatory reason (§5). */
export async function adminOverrideCancel(
  actor: Actor,
  serviceId: string,
  reason: string
): Promise<void> {
  authorize(actor, "service.transition");
  if (actor.role !== "admin") throw new Error("Admin only");
  if (!reason.trim()) throw new Error("A reason is required for an override");
  const ctx = await db.transaction(async (tx) => {
    const context = await serviceContext(tx, serviceId);
    await setStatus(
      tx,
      actor,
      serviceId,
      ["pending", "provisioning", "active", "suspended", "pending_cancellation"],
      "cancelled",
      { cancelReason: reason, nextInvoiceDate: null },
      { reason, override: true }
    );
    return context;
  });
  await getConnector(ctx.providerName).cancel(ctx);
  await notify("service_cancelled", {
    customerId: ctx.customerId,
    serviceName: ctx.planName,
  });
}

// ----------------------------------------------------------------- queries

export async function customerServices(customerId: string) {
  return db
    .select({
      service: services,
      plan: plans,
      provider: providers,
    })
    .from(services)
    .innerJoin(plans, eq(services.planId, plans.id))
    .innerJoin(providers, eq(plans.providerId, providers.id))
    .where(eq(services.customerId, customerId));
}

export async function customerNameFor(customerId: string): Promise<string> {
  const [c] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  if (!c) return "Unknown";
  return (
    c.companyName ?? [c.firstName, c.lastName].filter(Boolean).join(" ")
  );
}
