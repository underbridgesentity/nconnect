import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { leads, provisioningTasks, users, notifications } from "@/lib/db/schema";
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
          { label: "Email the customer the outcome", done: false },
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
  await bellSalesOnNewLead(leadId, data, phone);
  return leadId;
}

const SOURCE_LABEL: Record<string, string> = {
  web_coverage: "coverage check",
  web_abandoned: "abandoned signup",
  manual: "walk-in",
  referral: "referral",
};

/**
 * Speed to lead decides reseller conversion, so an unclaimed lead has to
 * announce itself. Every active rep gets the bell (admins if there are no
 * reps yet) and the first to claim it owns it.
 *
 * Deliberately outside the lead transaction and never allowed to throw: a
 * failed notification must not lose the lead that a customer just gave us.
 */
async function bellSalesOnNewLead(
  leadId: string,
  data: z.infer<typeof leadInput>,
  phone: string
): Promise<void> {
  try {
    const reps = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "sales"), eq(users.status, "active")));
    const recipients = reps.length
      ? reps
      : await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.role, "admin"), eq(users.status, "active")));
    if (recipients.length === 0) return;

    const detail =
      [data.interest, data.addressText].filter(Boolean).join(" · ") ||
      "No detail beyond the number, call to qualify.";
    await db.insert(notifications).values(
      recipients.map((user) => ({
        userId: user.id,
        type: "lead_created",
        title: `New ${SOURCE_LABEL[data.source] ?? data.source} lead: ${data.name}`,
        body: `${phone}. ${detail}`.slice(0, 300),
        link: `/sales/leads/${leadId}`,
      }))
    );
  } catch (err) {
    console.error(`lead ${leadId}: sales bell failed`, err);
  }
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
