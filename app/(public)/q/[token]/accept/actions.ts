"use server";

import { headers } from "next/headers";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import sharp from "sharp";
import { db } from "@/lib/db/client";
import { quotes, quoteItems, plans } from "@/lib/db/schema";
import {
  requestOtp,
  verifyOtp,
  otpFailureMessage,
  OtpRateLimitError,
} from "@/lib/auth/otp";
import {
  findOrCreateCustomer,
  createOrderFromQuote,
  SIM_CATEGORIES,
} from "@/lib/domain/orders";
import { uploadFile, randomFileName } from "@/lib/storage";
import { buildCheckout } from "@/lib/payfast";

/**
 * Quote acceptance (spec §9.5): OTP-verified contact -> address (+ RICA if
 * the quote includes a SIM service) -> order from quote snapshots -> PayFast.
 * State is kept client-side per step; every action re-validates the token.
 */

export type AcceptResult = { ok: boolean; error?: string };
const fail = (err: unknown): AcceptResult => ({
  ok: false,
  error: err instanceof Error ? err.message : "Failed",
});

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
  email: z.string().email().optional(),
});

/** Six digits. Checked before the code is spent, so a slip costs no tries. */
const codeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Codes are 6 digits. Check the message and try again.");

export async function acceptOtpRequestAction(
  token: string,
  form: FormData
): Promise<AcceptResult> {
  try {
    await validQuote(token);
    const parsed = contactSchema.safeParse({
      name: form.get("name"),
      phone: form.get("phone"),
      email: String(form.get("email") ?? "") || undefined,
    });
    if (!parsed.success) {
      return { ok: false, error: "Check your name and cellphone number" };
    }
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0] ?? null;
    await requestOtp(parsed.data.phone, ip);
    return { ok: true };
  } catch (err) {
    if (err instanceof OtpRateLimitError) return { ok: false, error: err.message };
    return fail(err);
  }
}

export async function acceptVerifyAction(
  token: string,
  form: FormData
): Promise<AcceptResult & { customerId?: string }> {
  try {
    await validQuote(token);
    const phone = String(form.get("phone"));
    const code = String(form.get("code"));
    const name = String(form.get("name"));
    const email = String(form.get("email") ?? "") || undefined;
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
    const otp = await verifyOtp(phone, parsedCode.data);
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
    return { ok: true, customerId };
  } catch (err) {
    return fail(err);
  }
}

async function processDoc(file: File, customerId: string, prefix: string) {
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
    const customerId = String(form.get("customerId"));
    if (!customerId) return { ok: false, error: "Verify your number first" };

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
