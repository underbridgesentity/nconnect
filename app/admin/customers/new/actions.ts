"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { customers, users, consents } from "@/lib/db/schema";
import { requireActor } from "@/lib/auth";
import { authorize } from "@/lib/auth/authorize";
import { writeAudit } from "@/lib/domain/audit";
import { emitDomainEvent, forwardDomainEvent } from "@/lib/domain/events";
import {
  isValidEmail,
  isValidPhone,
  normalizeEmail,
  normalizePhone,
} from "@/lib/auth/otp";
import { sendEmail } from "@/lib/notify/email";
import { appUrl } from "@/lib/config";

export type CreateCustomerResult =
  | { ok: true; customerId: string; inviteSent: boolean; inviteDetail?: string }
  | { ok: false; error: string; existingCustomerId?: string };

/**
 * Staff onboarding a walk-in, phone or migrated customer. Email is required
 * because it is the credential: an account without one can never sign in.
 * Phone is required because RICA needs a reachable number.
 */
const createCustomerSchema = z.object({
  firstName: z.string().trim().min(2, "First name is required").max(80),
  lastName: z.string().trim().max(80).optional(),
  companyName: z.string().trim().max(160).optional(),
  email: z
    .string()
    .trim()
    .refine(isValidEmail, "That email address does not look deliverable"),
  phone: z
    .string()
    .trim()
    .refine(isValidPhone, "That is not a valid South African number"),
  popiaConsent: z.literal(true, {
    message:
      "Confirm the customer agreed to POPIA processing before creating the account",
  }),
  sendInvite: z.boolean(),
});

export async function createCustomerAction(
  form: FormData
): Promise<CreateCustomerResult> {
  try {
    const actor = await requireActor();
    // Admin-only: customer.write with no resource fails closed for sales,
    // whose scope is "own" and cannot own a customer that does not exist yet.
    authorize(actor, "customer.write");

    const parsed = createCustomerSchema.safeParse({
      firstName: String(form.get("firstName") ?? ""),
      lastName: String(form.get("lastName") ?? "") || undefined,
      companyName: String(form.get("companyName") ?? "") || undefined,
      email: String(form.get("email") ?? ""),
      phone: String(form.get("phone") ?? ""),
      popiaConsent: form.get("popiaConsent") === "on",
      sendInvite: form.get("sendInvite") === "on",
    });
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Check the form and try again",
      };
    }
    const input = parsed.data;
    const email = normalizeEmail(input.email);
    const phone = normalizePhone(input.phone);
    const fullName = [input.firstName, input.lastName]
      .filter(Boolean)
      .join(" ");

    const eventIds: string[] = [];
    const outcome = await db.transaction(
      async (tx): Promise<CreateCustomerResult> => {
        // Email is the account key: same case-insensitive lookup sign-in uses.
        const [existingByEmail] = await tx
          .select()
          .from(users)
          .where(sql`lower(${users.email}) = lower(${email})`)
          .limit(1);

        if (existingByEmail && existingByEmail.role !== "customer") {
          return {
            ok: false,
            error: `${email} belongs to a staff account and cannot be a customer sign-in address.`,
          };
        }

        if (existingByEmail) {
          const [existingCustomer] = await tx
            .select({ id: customers.id })
            .from(customers)
            .where(eq(customers.userId, existingByEmail.id))
            .limit(1);
          if (existingCustomer) {
            return {
              ok: false,
              error: `A customer account already signs in with ${email}.`,
              existingCustomerId: existingCustomer.id,
            };
          }
        }

        // users.phone is unique. Refuse up front with a readable reason
        // instead of surfacing a raw constraint violation.
        const [phoneOwner] = await tx
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(eq(users.phone, phone))
          .limit(1);
        if (phoneOwner && phoneOwner.id !== existingByEmail?.id) {
          return {
            ok: false,
            error: `${phone} is already on another account${
              phoneOwner.email ? ` (${phoneOwner.email})` : ""
            }. Search for that customer instead of creating a duplicate.`,
          };
        }

        let userId: string;
        if (existingByEmail) {
          // A customer-role user with no customers row: repair rather than
          // block, the sign-in account already exists for this address.
          userId = existingByEmail.id;
        } else {
          const [user] = await tx
            .insert(users)
            .values({
              role: "customer",
              email,
              phone,
              name: fullName,
              status: "active",
            })
            .returning({ id: users.id });
          userId = user.id;
        }

        const [customer] = await tx
          .insert(customers)
          .values({
            userId,
            type: input.companyName ? "business" : "individual",
            firstName: input.firstName,
            lastName: input.lastName ?? null,
            companyName: input.companyName ?? null,
            phone,
            email,
            source: "admin",
          })
          .returning({ id: customers.id });

        await tx.insert(consents).values({
          customerId: customer.id,
          kind: "popia_processing",
          granted: true,
        });

        await writeAudit(tx, {
          actor,
          action: "customer.create",
          entity: "customer",
          entityId: customer.id,
          after: {
            name: fullName,
            companyName: input.companyName ?? null,
            email,
            phone,
            source: "admin",
          },
        });
        eventIds.push(
          await emitDomainEvent(tx, "customer.created", {
            customerId: customer.id,
            userId,
            source: "admin",
            createdBy: actor.userId,
          })
        );

        return { ok: true, customerId: customer.id, inviteSent: false };
      }
    );
    for (const id of eventIds) await forwardDomainEvent(id);
    if (!outcome.ok) return outcome;

    let inviteSent = false;
    let inviteDetail: string | undefined;
    if (input.sendInvite) {
      const link = `${appUrl()}/login`;
      const result = await sendEmail({
        to: email,
        subject: "Your Needd Connect account is ready",
        html: inviteEmailHtml({ name: input.firstName, email, link }),
        text:
          `Hi ${input.firstName}, your Needd Connect account is ready. ` +
          `Sign in with this email address at ${link}. We email you a ` +
          `6-digit code each time, there is no password to remember.`,
      });
      inviteSent = result.ok;
      if (!result.ok) {
        inviteDetail = `The account was created, but the sign-in email could not be sent: ${
          result.detail ?? "delivery failed"
        }. The customer can still sign in at ${link} with ${email}.`;
      }
    }

    revalidatePath("/admin/customers");
    return { ok: true, customerId: outcome.customerId, inviteSent, inviteDetail };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to create the customer",
    };
  }
}

function inviteEmailHtml(input: {
  name: string;
  email: string;
  link: string;
}): string {
  return `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#121829">
  <p>Hi ${input.name},</p>
  <p>Your Needd Connect account is ready. Sign in with this email address, <strong>${input.email}</strong>, and we will email you a 6-digit code each time. There is no password to remember.</p>
  <p><a href="${input.link}" style="display:inline-block;background:#136FB0;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none">Sign in to your account</a></p>
  <p style="font-size:13px;color:#5b6478">Your account shows your services, invoices and payments in one place.</p>
  <p>Needd Connect</p>
</div>`;
}
