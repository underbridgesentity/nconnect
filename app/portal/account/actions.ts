"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { customers, consents, users, notifications } from "@/lib/db/schema";
import { requireActor } from "@/lib/auth";
import { writeAudit } from "@/lib/domain/audit";
import { emitDomainEvent, forwardDomainEvent } from "@/lib/domain/events";
import {
  requestOtp,
  verifyOtp,
  otpFailureMessage,
  otpThrottleState,
  isValidEmail,
  normalizeEmail,
  emailTarget,
  OtpRateLimitError,
  OTP_TTL_SECONDS,
} from "@/lib/auth/otp";
import {
  checkEmailAvailability,
  emailTakenMessage,
} from "@/lib/auth/customer-account";
import { customerFacingError } from "@/app/portal/_lib/errors";
import { and } from "drizzle-orm";

export type Result = { ok: boolean; error?: string };
/** Customer-facing copy only: raw domain and driver messages stay in the log. */
const fail = (err: unknown): Result => ({
  ok: false,
  error: customerFacingError(err),
});

const profileSchema = z.object({
  firstName: z.string().trim().max(100),
  lastName: z.string().trim().max(100),
});

/**
 * Names only. The email address is the sign-in credential now, so it does not
 * ride along on a casual profile save: it changes through the two-step
 * request/confirm flow below, which proves the customer can read mail at the
 * new address before anything is written.
 */
export async function updateProfileAction(form: FormData): Promise<Result> {
  try {
    const actor = await requireActor();
    if (!actor.customerId) throw new Error("No customer account");
    const parsed = profileSchema.safeParse({
      firstName: String(form.get("firstName") ?? ""),
      lastName: String(form.get("lastName") ?? ""),
    });
    if (!parsed.success) {
      return { ok: false, error: "Those names are too long to save." };
    }
    const { firstName, lastName } = parsed.data;
    await db.transaction(async (tx) => {
      await tx
        .update(customers)
        .set({ firstName: firstName || null, lastName: lastName || null })
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
        after: { firstName, lastName },
      });
    });
    revalidatePath("/portal/account");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const BAD_NEW_EMAIL =
  "That does not look like an email address we can send a code to. Check it and try again.";

export type EmailChangeStartResult = Result & {
  /** Normalised, the address the code actually went to. */
  email?: string;
  expiresInSeconds?: number;
  resendInSeconds?: number;
};

/**
 * Step one of changing the sign-in email: prove the new address is real and
 * reachable by sending a code to it. Nothing is written until the code comes
 * back through confirmEmailChangeAction.
 */
export async function requestEmailChangeAction(input: {
  newEmail: string;
}): Promise<EmailChangeStartResult> {
  try {
    const actor = await requireActor();
    if (!actor.customerId) throw new Error("No customer account");
    if (!isValidEmail(input.newEmail)) {
      return { ok: false, error: BAD_NEW_EMAIL };
    }
    const email = normalizeEmail(input.newEmail);

    const [me] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, actor.userId))
      .limit(1);
    if (me?.email && me.email.toLowerCase() === email) {
      return { ok: false, error: "That is already your sign-in address." };
    }

    const availability = await checkEmailAvailability(email);
    if (availability.status !== "free") {
      return { ok: false, error: emailTakenMessage(availability) };
    }

    const target = emailTarget(email);
    const throttle = await otpThrottleState(target);
    if (throttle.resendInSeconds > 0) {
      return {
        ok: true,
        email,
        expiresInSeconds: Math.max(
          0,
          OTP_TTL_SECONDS - (throttle.liveCodeSentSecondsAgo ?? 0)
        ),
        resendInSeconds: throttle.resendInSeconds,
      };
    }

    const ip =
      (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    const sent = await requestOtp(target, ip);
    return {
      ok: true,
      email: sent.identifier,
      expiresInSeconds: sent.expiresInSeconds,
      resendInSeconds: sent.resendInSeconds,
    };
  } catch (err) {
    if (err instanceof OtpRateLimitError) {
      return { ok: false, error: err.message };
    }
    return fail(err);
  }
}

const codeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Codes are 6 digits. Check the email and try again.");

/**
 * Step two: the code proves ownership of the new address, then users.email
 * (the credential) and customers.email (where notifications go) move together
 * in one transaction, so sign-in and mail can never point at different places.
 */
export async function confirmEmailChangeAction(input: {
  newEmail: string;
  code: string;
}): Promise<Result> {
  try {
    const actor = await requireActor();
    if (!actor.customerId) throw new Error("No customer account");
    if (!isValidEmail(input.newEmail)) {
      return { ok: false, error: BAD_NEW_EMAIL };
    }
    const email = normalizeEmail(input.newEmail);
    const parsedCode = codeSchema.safeParse(input.code);
    if (!parsedCode.success) {
      return { ok: false, error: parsedCode.error.issues[0]!.message };
    }

    const verdict = await verifyOtp(emailTarget(email), parsedCode.data);
    if (!verdict.ok) {
      return { ok: false, error: otpFailureMessage(verdict) };
    }

    // Re-checked after the code: someone else may have claimed the address
    // while the code sat in the inbox. The unique index on users.email is the
    // final word if two confirmations race past this check.
    const availability = await checkEmailAvailability(email);
    if (availability.status !== "free") {
      return { ok: false, error: emailTakenMessage(availability) };
    }

    const [before] = await db
      .select({ userEmail: users.email })
      .from(users)
      .where(eq(users.id, actor.userId))
      .limit(1);
    const [customerBefore] = await db
      .select({ email: customers.email })
      .from(customers)
      .where(eq(customers.id, actor.customerId))
      .limit(1);

    let eventId: string | null = null;
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ email })
        .where(eq(users.id, actor.userId));
      await tx
        .update(customers)
        .set({ email })
        .where(eq(customers.id, actor.customerId!));
      await writeAudit(tx, {
        actor,
        action: "customer.email_change",
        entity: "customer",
        entityId: actor.customerId!,
        before: {
          userEmail: before?.userEmail ?? null,
          customerEmail: customerBefore?.email ?? null,
        },
        after: { userEmail: email, customerEmail: email },
      });
      eventId = await emitDomainEvent(tx, "customer.email_changed", {
        customerId: actor.customerId,
        userId: actor.userId,
        email,
      });
    });
    if (eventId) await forwardDomainEvent(eventId);
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
