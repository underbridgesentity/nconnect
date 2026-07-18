import "server-only";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { leads, provisioningTasks } from "@/lib/db/schema";
import { writeAudit } from "./audit";
import { emitDomainEvent, forwardDomainEvent } from "./events";
import { normalizePhone } from "@/lib/auth/otp";

/**
 * Lead capture (spec §4.6). Public flows (coverage, abandoned signup) create
 * leads without an actor; staff flows pass one. Every lead lands in the
 * admin/sales queues.
 */

const leadInput = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().min(9).max(15),
  email: z.string().email().nullish(),
  source: z.enum(leads.source.enumValues),
  interest: z.string().max(500).nullish(),
  addressText: z.string().max(500).nullish(),
});

export async function createLead(
  input: z.infer<typeof leadInput> & { feasibilityTask?: boolean }
): Promise<string> {
  const { feasibilityTask, ...rest } = input;
  const data = leadInput.parse(rest);
  const phone = normalizePhone(data.phone);

  const { leadId, eventId } = await db.transaction(async (tx) => {
    const [lead] = await tx
      .insert(leads)
      .values({ ...data, phone })
      .returning({ id: leads.id });
    await writeAudit(tx, {
      actor: null,
      action: "lead.create",
      entity: "lead",
      entityId: lead.id,
      after: { ...data, phone },
    });

    // Fibre coverage promise (spec §7): a feasibility task joins the lead so
    // it lands in the Today queue with a one-business-day due date.
    if (feasibilityTask) {
      await tx.insert(provisioningTasks).values({
        serviceId: null,
        leadId: lead.id,
        type: "feasibility_check",
        status: "open",
        dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        checklist: [
          { label: "Check address on FNO coverage tools", done: false },
          { label: "Confirm availability (or honest alternatives)", done: false },
          { label: "WhatsApp the customer the outcome", done: false },
        ],
      });
    }

    const eventId = await emitDomainEvent(tx, "lead.created", {
      leadId: lead.id,
      source: data.source,
    });
    return { leadId: lead.id, eventId };
  });
  await forwardDomainEvent(eventId);
  return leadId;
}

/** Close a feasibility task from its lead (Today queue action). */
export async function closeFeasibilityTask(
  taskId: string,
  actorUserId: string,
  resultNotes: string
): Promise<void> {
  const { eq } = await import("drizzle-orm");
  await db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(provisioningTasks)
      .where(eq(provisioningTasks.id, taskId))
      .limit(1);
    if (!task || task.status === "done") return;
    await tx
      .update(provisioningTasks)
      .set({
        status: "done",
        checklist: task.checklist.map((c) => ({ ...c, done: true })),
        resultNotes,
        completedBy: actorUserId,
        completedAt: new Date(),
      })
      .where(eq(provisioningTasks.id, taskId));
    await writeAudit(tx, {
      actor: { userId: actorUserId, role: "admin" },
      action: "provisioning.feasibility_check.complete",
      entity: "provisioning_task",
      entityId: taskId,
      after: { resultNotes },
    });
  });
}
