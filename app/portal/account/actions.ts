"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { customers, consents, users, notifications } from "@/lib/db/schema";
import { requireActor } from "@/lib/auth";
import { writeAudit } from "@/lib/domain/audit";
import { customerFacingError } from "@/app/portal/_lib/errors";
import { and } from "drizzle-orm";

export type Result = { ok: boolean; error?: string };
/** Customer-facing copy only: raw domain and driver messages stay in the log. */
const fail = (err: unknown): Result => ({
  ok: false,
  error: customerFacingError(err),
});

export async function updateProfileAction(form: FormData): Promise<Result> {
  try {
    const actor = await requireActor();
    if (!actor.customerId) throw new Error("No customer account");
    const firstName = String(form.get("firstName") ?? "").trim();
    const lastName = String(form.get("lastName") ?? "").trim();
    const email = String(form.get("email") ?? "").trim() || null;
    await db.transaction(async (tx) => {
      await tx
        .update(customers)
        .set({ firstName: firstName || null, lastName: lastName || null, email })
        .where(eq(customers.id, actor.customerId!));
      await tx
        .update(users)
        .set({ name: [firstName, lastName].filter(Boolean).join(" ") || "Customer" })
        .where(eq(users.id, actor.userId));
      await writeAudit(tx, {
        actor,
        action: "customer.self_update",
        entity: "customer",
        entityId: actor.customerId!,
        after: { firstName, lastName, email },
      });
    });
    revalidatePath("/portal/account");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function updateMarketingConsentAction(
  kind: "marketing_whatsapp" | "marketing_email",
  granted: boolean
): Promise<Result> {
  try {
    const actor = await requireActor();
    if (!actor.customerId) throw new Error("No customer account");
    const hdrs = await headers();
    await db.insert(consents).values({
      customerId: actor.customerId,
      kind,
      granted,
      ip: hdrs.get("x-forwarded-for")?.split(",")[0] ?? null,
      userAgent: hdrs.get("user-agent"),
    });
    revalidatePath("/portal/account");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** POPIA access request (spec §9.3/§13): creates an admin task, confirms in writing. */
export async function requestMyDataAction(): Promise<Result> {
  try {
    const actor = await requireActor();
    if (!actor.customerId) throw new Error("No customer account");

    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, actor.customerId))
      .limit(1);
    const name =
      customer?.companyName ??
      [customer?.firstName, customer?.lastName].filter(Boolean).join(" ");

    const admins = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.status, "active")));

    await db.transaction(async (tx) => {
      if (admins.length) {
        await tx.insert(notifications).values(
          admins.map((a) => ({
            userId: a.id,
            type: "popia_access_request",
            title: `POPIA data request: ${name}`,
            body: "Export this customer's records from the 360 page and send them within a reasonable time. Confirmed to the customer in writing.",
            link: `/admin/customers/${actor.customerId}`,
          }))
        );
      }
      await writeAudit(tx, {
        actor,
        action: "popia.access_request",
        entity: "customer",
        entityId: actor.customerId!,
        after: { requestedAt: new Date().toISOString() },
      });
    });

    // Written confirmation (§9.3).
    if (customer?.email) {
      const { sendEmail } = await import("@/lib/notify/email");
      await sendEmail({
        to: customer.email,
        subject: "We've received your data access request",
        html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px"><p>Hi ${customer.firstName ?? ""},</p><p>We've received your POPIA access request and will send you an export of the personal information we hold about you. Note that RICA records are retained for 5 years after service termination as required by law.</p><p>Needd Connect</p></div>`,
        text: "We've received your POPIA access request and will send you an export of the personal information we hold about you.",
      });
    }
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
