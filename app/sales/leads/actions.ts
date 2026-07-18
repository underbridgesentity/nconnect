"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { leads, leadActivities } from "@/lib/db/schema";
import { requireActor } from "@/lib/auth";
import { authorize } from "@/lib/auth/authorize";
import { writeAudit } from "@/lib/domain/audit";
import { normalizePhone } from "@/lib/auth/otp";

export type Result = { ok: boolean; error?: string; leadId?: string };
const fail = (err: unknown): Result => ({
  ok: false,
  error: err instanceof Error ? err.message : "Failed",
});

export async function quickAddLeadAction(form: FormData): Promise<Result> {
  try {
    const actor = await requireActor();
    authorize(actor, "lead.write", { ownerUserId: actor.userId });
    const name = String(form.get("name") ?? "").trim();
    const phone = normalizePhone(String(form.get("phone") ?? ""));
    if (name.length < 2) throw new Error("A name is needed");

    const leadId = await db.transaction(async (tx) => {
      const [lead] = await tx
        .insert(leads)
        .values({
          name,
          phone,
          email: String(form.get("email") ?? "").trim() || null,
          interest: String(form.get("interest") ?? "").trim() || null,
          source: "manual",
          ownerSalesId: actor.userId,
        })
        .returning({ id: leads.id });
      await writeAudit(tx, {
        actor,
        action: "lead.create",
        entity: "lead",
        entityId: lead.id,
        after: { name, phone },
      });
      return lead.id;
    });
    revalidatePath("/sales/leads");
    return { ok: true, leadId };
  } catch (err) {
    return fail(err);
  }
}

async function leadScope(leadId: string) {
  const [lead] = await db
    .select({ ownerSalesId: leads.ownerSalesId })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);
  return { ownerUserId: lead?.ownerSalesId };
}

export async function logActivityAction(form: FormData): Promise<Result> {
  try {
    const actor = await requireActor();
    const leadId = String(form.get("leadId"));
    authorize(actor, "lead.write", await leadScope(leadId));
    await db.insert(leadActivities).values({
      leadId,
      kind: String(form.get("kind")) as "note" | "call" | "whatsapp",
      body: String(form.get("body") ?? "").trim(),
      createdBy: actor.userId,
    });
    revalidatePath(`/sales/leads/${leadId}`);
    return { ok: true };
  } catch (err) {
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
    authorize(actor, "lead.write", await leadScope(leadId));
    await db.transaction(async (tx) => {
      const [before] = await tx
        .select({ status: leads.status })
        .from(leads)
        .where(eq(leads.id, leadId))
        .limit(1);
      await tx
        .update(leads)
        .set({ status, lostReason: lostReason ?? null })
        .where(eq(leads.id, leadId));
      await tx.insert(leadActivities).values({
        leadId,
        kind: "status_change",
        body: `${before?.status} → ${status}${lostReason ? `: ${lostReason}` : ""}`,
        createdBy: actor.userId,
      });
    });
    revalidatePath(`/sales/leads/${leadId}`);
    revalidatePath("/sales/leads");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Unowned web leads can be claimed by a rep. */
export async function claimLeadAction(leadId: string): Promise<Result> {
  try {
    const actor = await requireActor();
    await db
      .update(leads)
      .set({ ownerSalesId: actor.userId })
      .where(eq(leads.id, leadId));
    revalidatePath("/sales/leads");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
