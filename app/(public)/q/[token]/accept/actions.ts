"use server";

import { headers } from "next/headers";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { quotes, quoteItems, plans } from "@/lib/db/schema";
import {
  requestOtp,
  verifyOtp,
  otpFailureMessage,
  normalizeEmail,
  isValidEmail,
  OtpRateLimitError,
} from "@/lib/auth/otp";
import {
  findOrCreateCustomer,
  createOrderFromQuote,
  SIM_CATEGORIES,
} from "@/lib/domain/orders";
import { uploadFile, randomFileName } from "@/lib/storage";
import { buildCheckout } from "@/lib/payfast";
import { setAcceptVerified, readAcceptVerified } from "./verified";
import { VERIFY_FIRST_ERROR } from "./messages";

/**
 * Quote acceptance (spec §9.5): OTP-verified contact -> address (+ RICA if
 * the quote includes a SIM service) -> order from quote snapshots -> PayFast.
 * State is kept client-side per step; every action re-validates the token.
 *
 * The code goes to the customer's EMAIL, because email is now the credential
 * a customer signs in with. The cellphone number is still required and still
 * collected here: RICA needs a contactable number for any SIM-based service,
 * it simply is not what proves who you are any more.
 */

export type AcceptResult = { ok: boolean; error?: string };
const fail = (err: unknown): { ok: false; error: string } => ({
  ok: false,
  error: err instanceof Error ? err.message : "Failed",
});

/**
 * The answer to "send a code". `resendIn` is the OTP library's own cooldown,
 * handed back rather than restated on the client: this screen used to count
 * down from thirty seconds while the service worked in sixty, so the button
 * came alive half a minute before it would do anything.
 */
export type OtpRequestResult =
  | { ok: true; resendIn: number }
  | { ok: false; error?: string };

async function validQuote(token: string) {
  const [quote] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.shareToken, token))
    .limit(1);
  if (!quote) throw new Error("Quote not found");
  if (quote.acceptedOrderId) throw new Error("Quote already accepted");
  if (quote.expiresAt && quote.expiresAt.getTime() < Date.now()) {
    throw new Error("This quote has expired");
  }
  return quote;
}

export async function quoteRequiresRica(token: string): Promise<boolean> {
  const quote = await validQuote(token);
  const items = await db
    .select()
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, quote.id));
  const planIds = items.flatMap((i) => (i.planId ? [i.planId] : []));
  if (!planIds.length) return false;
  const planRows = await db
    .select()
    .from(plans)
    .where(inArray(plans.id, planIds));
  return planRows.some((p) =>
    (SIM_CATEGORIES as readonly string[]).includes(p.category)
  );
}

const contactSchema = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().min(9).max(15),
  email: z
    .string()
    .trim()
    .refine(isValidEmail, "Enter a valid email address")
    .transform(normalizeEmail),
});

/** Six digits. Checked before the code is spent, so a slip costs no tries. */
const codeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Codes are 6 digits. Check the email and try again.");

export async function acceptOtpRequestAction(
  token: string,
  form: FormData
): Promise<OtpRequestResult> {
  try {
    await validQuote(token);
    const parsed = contactSchema.safeParse({
      name: form.get("name"),
      phone: form.get("phone"),
      email: String(form.get("email") ?? ""),
    });
    if (!parsed.success) {
      return {
        ok: false,
        error:
          "Check your name, email address and cellphone number, we need all three.",
      };
    }
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0] ?? null;
    const sent = await requestOtp(
      { identifier: parsed.data.email, channel: "email" },
      ip
    );
    return { ok: true, resendIn: sent.resendInSeconds };
  } catch (err) {
    if (err instanceof OtpRateLimitError) return { ok: false, error: err.message };
    return fail(err);
  }
}

export async function acceptVerifyAction(
  token: string,
  form: FormData
): Promise<AcceptResult> {
  try {
    await validQuote(token);
    const phone = String(form.get("phone"));
    const code = String(form.get("code"));
    const name = String(form.get("name"));
    const rawEmail = String(form.get("email") ?? "");
    if (!isValidEmail(rawEmail)) {
      return { ok: false, error: "Enter a valid email address" };
    }
    const email = normalizeEmail(rawEmail);
    if (form.get("popiaConsent") !== "on") {
      return {
        ok: false,
        error: "We need your consent to process your information.",
      };
    }
    const parsedCode = codeSchema.safeParse(code);
    if (!parsedCode.success) {
      return { ok: false, error: parsedCode.error.issues[0]!.message };
    }

    // "That code didn't match" was the answer to four different problems.
    // The library's verdict tells the customer which one they have: expired,
    // out of tries, already used, or mistyped with N tries left.
    const otp = await verifyOtp(
      { identifier: email, channel: "email" },
      parsedCode.data
    );
    if (!otp.ok) return { ok: false, error: otpFailureMessage(otp) };

    const hdrs = await headers();
    const { customerId } = await findOrCreateCustomer({
      phone,
      name,
      email,
      popiaConsent: true,
      ip: hdrs.get("x-forwarded-for")?.split(",")[0] ?? null,
      userAgent: hdrs.get("user-agent"),
    });
    // The verified identity never travels to the browser. It is held in an
    // httpOnly cookie signed over this quote's token, and the finalize action
    // reads it back from there: a form field would let anyone skip this step
    // and accept the quote as whatever customer id they typed in.
    await setAcceptVerified(token, customerId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/*
 * sharp is loaded where it is used, not at module scope.
 *
 * This module is imported by the page that renders the form, so a top-level
 * import pulled sharp's native binding into every render of that page. On
 * Vercel's linux-x64 runtime the binding failed to load and took the whole page
 * down with a 500, even though nothing on it was processing an image. Loading
 * it inside the handler keeps the failure where it belongs: an upload that
 * cannot be processed, not a page that cannot be viewed.
 */
async function processDoc(file: File, customerId: string, prefix: string) {
  const sharp = (await import("sharp")).default;
  const input = Buffer.from(await file.arrayBuffer());
  const webp = await sharp(input)
    .rotate()
    .resize({ width: 2000, withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();
  const path = `rica/${customerId}/${prefix}-${randomFileName(".webp")}`;
  await uploadFile("compliance", path, webp, "image/webp");
  return path;
}

export async function acceptFinalizeAction(
  token: string,
  form: FormData
): Promise<
  AcceptResult & { actionUrl?: string; fields?: Record<string, string> }
> {
  try {
    const quote = await validQuote(token);
    // Identity comes from the signed httpOnly cookie the verify step set for
    // this exact quote, never from the form: a browser-supplied customerId
    // would make the email code decorative.
    const customerId = await readAcceptVerified(token);
    if (!customerId) {
      return { ok: false, error: VERIFY_FIRST_ERROR };
    }

    const needsRica = await quoteRequiresRica(token);
    let rica = null;
    if (needsRica) {
      const idNumber = String(form.get("idNumber") ?? "").replace(/\s/g, "");
      const idDoc = form.get("idDoc") as File | null;
      const poaDoc = form.get("poaDoc") as File | null;
      if (!idNumber || !idDoc?.size || !poaDoc?.size) {
        return {
          ok: false,
          error: "This quote includes a SIM, ID number and both documents are required",
        };
      }
      rica = {
        idNumber,
        idDocPath: await processDoc(idDoc, customerId, "id"),
        poaDocPath: await processDoc(poaDoc, customerId, "poa"),
      };
    }

    const order = await createOrderFromQuote({
      quoteId: quote.id,
      customerId,
      address: {
        line1: String(form.get("line1")),
        line2: String(form.get("line2") ?? "") || null,
        suburb: String(form.get("suburb") ?? "") || null,
        city: String(form.get("city")),
        postalCode: String(form.get("postalCode") ?? "") || null,
      },
      rica,
    });

    const nameParts = String(form.get("name") ?? "").trim().split(/\s+/);
    const checkout = buildCheckout({
      paymentId: order.orderId,
      amountCents: order.totalCents,
      itemName: `Needd Connect order ${order.orderNumber}`,
      customerFirstName: nameParts[0] || undefined,
      customerLastName: nameParts.slice(1).join(" ") || undefined,
      customerEmail: String(form.get("email") ?? "") || undefined,
      tokenize: true,
    });
    return { ok: true, ...checkout };
  } catch (err) {
    return fail(err);
  }
}

/** Prefill from the lead so the customer types as little as possible. */
export async function acceptPrefill(token: string): Promise<{
  name: string;
  phone: string;
  email: string;
  requiresRica: boolean;
} | null> {
  try {
    const quote = await validQuote(token);
    const requiresRica = await quoteRequiresRica(token);
    if (quote.leadId) {
      const { leads } = await import("@/lib/db/schema");
      const [lead] = await db
        .select()
        .from(leads)
        .where(eq(leads.id, quote.leadId))
        .limit(1);
      if (lead) {
        return {
          name: lead.name,
          phone: lead.phone,
          email: lead.email ?? "",
          requiresRica,
        };
      }
    }
    return { name: "", phone: "", email: "", requiresRica };
  } catch {
    return null;
  }
}
