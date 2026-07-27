"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { leads, leadActivities, users } from "@/lib/db/schema";
import { requireActor } from "@/lib/auth";
import { authorize, type Actor } from "@/lib/auth/authorize";
import { writeAudit } from "@/lib/domain/audit";
import { normalizePhone } from "@/lib/auth/otp";

export type Result = { ok: boolean; error?: string; leadId?: string };
const fail = (err: unknown): Result => ({
  ok: false,
  error: err instanceof Error ? err.message : "Failed",
});

const quickAddSchema = z.object({
  name: z.string().trim().min(2, "A name is needed").max(120),
  phone: z.string().trim().min(9, "A cellphone number is needed").max(20),
  email: z.string().trim().email("That email address does not look right").or(z.literal("")),
  interest: z.string().trim().max(500),
});

const activitySchema = z.object({
  leadId: z.string().uuid(),
  kind: z.enum(["note", "call", "whatsapp"]),
  body: z.string().trim().min(1, "Write what happened").max(2000),
});

const statusSchema = z.object({
  leadId: z.string().uuid(),
  status: z.enum(["new", "contacted", "quoted", "won", "lost"]),
  lostReason: z.string().trim().max(500).optional(),
});

async function actorName(actor: Actor): Promise<string> {
  const [user] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, actor.userId))
    .limit(1);
  return user?.name ?? "a rep";
}

export async function quickAddLeadAction(form: FormData): Promise<Result> {
  try {
    const actor = await requireActor();
    authorize(actor, "lead.write", { ownerUserId: actor.userId });
    const data = quickAddSchema.parse({
      name: String(form.get("name") ?? ""),
      phone: String(form.get("phone") ?? ""),
      email: String(form.get("email") ?? ""),
      interest: String(form.get("interest") ?? ""),
    });
    const phone = normalizePhone(data.phone);

    const leadId = await db.transaction(async (tx) => {
      const [lead] = await tx
        .insert(leads)
        .values({
          name: data.name,
          phone,
          email: data.email || null,
          interest: data.interest || null,
          source: "manual",
          ownerSalesId: actor.userId,
        })
        .returning({ id: leads.id });
      await writeAudit(tx, {
        actor,
        action: "lead.create",
        entity: "lead",
        entityId: lead.id,
        after: { name: data.name, phone, ownerSalesId: actor.userId },
      });
      return lead.id;
    });
    revalidatePath("/sales/leads");
    return { ok: true, leadId };
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { ok: false, error: err.issues[0]?.message ?? "Check the details" };
    }
    return fail(err);
  }
}

async function leadScope(leadId: string) {
  const [lead] = await db
    .select({ ownerSalesId: leads.ownerSalesId })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);
  if (!lead) throw new Error("That lead no longer exists");
  return { ownerUserId: lead.ownerSalesId };
}

export async function logActivityAction(form: FormData): Promise<Result> {
  try {
    const actor = await requireActor();
    const data = activitySchema.parse({
      leadId: String(form.get("leadId") ?? ""),
      kind: String(form.get("kind") ?? ""),
      body: String(form.get("body") ?? ""),
    });
    authorize(actor, "lead.write", await leadScope(data.leadId));

    await db.transaction(async (tx) => {
      const [activity] = await tx
        .insert(leadActivities)
        .values({
          leadId: data.leadId,
          kind: data.kind,
          body: data.body,
          createdBy: actor.userId,
        })
        .returning({ id: leadActivities.id });
      await writeAudit(tx, {
        actor,
        action: "lead.activity",
        entity: "lead",
        entityId: data.leadId,
        after: { activityId: activity.id, kind: data.kind },
      });
    });
    revalidatePath(`/sales/leads/${data.leadId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { ok: false, error: err.issues[0]?.message ?? "Check the details" };
    }
    return fail(err);
  }
}

export async function setLeadStatusAction(
  leadId: string,
  status: "new" | "contacted" | "quoted" | "won" | "lost",
  lostReason?: string
): Promise<Result> {
  try {
    const actor = await requireActor();
    const data = statusSchema.parse({ leadId, status, lostReason });
    authorize(actor, "lead.write", await leadScope(data.leadId));
    await db.transaction(async (tx) => {
      const [before] = await tx
        .select({ status: leads.status })
        .from(leads)
        .where(eq(leads.id, data.leadId))
        .limit(1);
      await tx
        .update(leads)
        .set({ status: data.status, lostReason: data.lostReason || null })
        .where(eq(leads.id, data.leadId));
      await tx.insert(leadActivities).values({
        leadId: data.leadId,
        kind: "status_change",
        body: `${before?.status} → ${data.status}${data.lostReason ? `: ${data.lostReason}` : ""}`,
        createdBy: actor.userId,
      });
      await writeAudit(tx, {
        actor,
        action: "lead.status",
        entity: "lead",
        entityId: data.leadId,
        before: { status: before?.status ?? null },
        after: { status: data.status, lostReason: data.lostReason || null },
      });
    });
    revalidatePath(`/sales/leads/${data.leadId}`);
    revalidatePath("/sales/leads");
    return { ok: true };
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { ok: false, error: err.issues[0]?.message ?? "Check the details" };
    }
    return fail(err);
  }
}

/**
 * Claim an unowned web lead.
 *
 * Ownership decides commission attribution, so this is a guarded mutation like
 * any other: the update itself carries the `owner_sales_id IS NULL` condition,
 * which makes it the race winner rather than the last writer, and it leaves an
 * audit row plus a visible activity entry so the trail exists if two reps ever
 * disagree about who got there first.
 */
export async function claimLeadAction(leadId: string): Promise<Result> {
  try {
    const actor = await requireActor();
    const id = z.string().uuid().parse(leadId);
    authorize(actor, "lead.write", { ownerUserId: actor.userId });
    const name = await actorName(actor);

    await db.transaction(async (tx) => {
      const claimed = await tx
        .update(leads)
        .set({ ownerSalesId: actor.userId })
        .where(and(eq(leads.id, id), isNull(leads.ownerSalesId)))
        .returning({ id: leads.id });
      if (claimed.length === 0) {
        throw new Error("Another rep just claimed this one");
      }
      await tx.insert(leadActivities).values({
        leadId: id,
        kind: "status_change",
        body: `Claimed by ${name}`,
        createdBy: actor.userId,
      });
      await writeAudit(tx, {
        actor,
        action: "lead.claim",
        entity: "lead",
        entityId: id,
        before: { ownerSalesId: null },
        after: { ownerSalesId: actor.userId },
      });
    });

    revalidatePath("/sales/leads");
    revalidatePath(`/sales/leads/${id}`);
    revalidatePath("/sales");
    return { ok: true, leadId: id };
  } catch (err) {
    if (err instanceof z.ZodError) return { ok: false, error: "Unknown lead" };
    return fail(err);
  }
}
