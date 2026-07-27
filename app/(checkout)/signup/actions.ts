"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import sharp from "sharp";
import {
  readDraft,
  writeDraft,
  startNewDraftOrder,
  classifyLeadError,
  type SignupDraftState,
} from "@/lib/domain/signup";
import {
  requestOtp,
  verifyOtp,
  otpThrottleState,
  otpFailureMessage,
  OtpRateLimitError,
  PhoneFormatError,
  OTP_TTL_SECONDS,
  OTP_RESEND_COOLDOWN_SECONDS,
  type OtpThrottleState,
} from "@/lib/auth/otp";
import {
  findOrCreateCustomer,
  createOrder,
  priceCart,
  orderMatchesCart,
  cancelStaleOrder,
} from "@/lib/domain/orders";
import { createLead } from "@/lib/domain/leads";
import { uploadFile, randomFileName } from "@/lib/storage";

export type WizardResult = { ok: boolean; error?: string };

/**
 * Anything that changes what is being bought, or where it goes, drops the
 * order the customer may already have created at review. The next checkout
 * then re-prices and rebuilds it, so the amount charged always equals the
 * amount on screen (spec §9.2).
 */
const DROP_ORDER = { orderId: null, orderNumber: null } as const;

// ------------------------------------------------------------------ step 1

export async function chooseSelectionAction(form: FormData): Promise<void> {
  const planSlug = String(form.get("planSlug") ?? "") || undefined;
  const bundleSlug = String(form.get("bundleSlug") ?? "") || undefined;
  await writeDraft({
    ...DROP_ORDER,
    planSlug: bundleSlug ? null : planSlug,
    bundleSlug: bundleSlug ?? null,
    step: 1,
  });
  redirect("/signup?step=1");
}

export async function toggleHardwareAction(form: FormData): Promise<void> {
  const sku = String(form.get("sku"));
  const draft = await readDraft();
  const hardware = draft.hardware ?? [];
  const existing = hardware.find((h) => h.sku === sku);
  const next = existing
    ? hardware.filter((h) => h.sku !== sku)
    : [...hardware, { sku, qty: 1 }];
  await writeDraft({ ...DROP_ORDER, hardware: next });
  redirect("/signup?step=1");
}

export async function continueToAddressAction(form: FormData): Promise<void> {
  // Deep-linked selections (?plan= / ?bundle=) arrive as hidden fields, // cookies can only be written here, not during page render.
  const planSlug = String(form.get("planSlug") ?? "") || undefined;
  const bundleSlug = String(form.get("bundleSlug") ?? "") || undefined;
  const draft = await readDraft();
  const effectivePlan = planSlug ?? draft.planSlug;
  const effectiveBundle = bundleSlug ?? draft.bundleSlug;
  if (!effectivePlan && !effectiveBundle) redirect("/signup?step=1");
  await writeDraft({
    ...DROP_ORDER,
    planSlug: effectiveBundle ? null : effectivePlan,
    bundleSlug: effectiveBundle ?? null,
    step: 2,
  });
  redirect("/signup?step=2");
}

/** Buy something else after a completed order, without losing the account. */
export async function startNewOrderAction(): Promise<void> {
  await startNewDraftOrder();
  redirect("/signup?step=1");
}

// ------------------------------------------------------------------ step 2

const addressSchema = z.object({
  line1: z.string().min(3).max(200),
  line2: z.string().max(200).optional(),
  suburb: z.string().max(120).optional(),
  city: z.string().min(2).max(120),
  province: z.string().max(60).optional(),
  postalCode: z.string().max(10).optional(),
});

export async function submitAddressAction(form: FormData): Promise<void> {
  const typed = {
    line1: String(form.get("line1") ?? "").trim(),
    line2: String(form.get("line2") ?? "").trim(),
    suburb: String(form.get("suburb") ?? "").trim(),
    city: String(form.get("city") ?? "").trim(),
    province: String(form.get("province") ?? "").trim(),
    postalCode: String(form.get("postalCode") ?? "").trim(),
  };
  const parsed = addressSchema.safeParse({
    line1: typed.line1,
    line2: typed.line2 || undefined,
    suburb: typed.suburb || undefined,
    city: typed.city,
    province: typed.province || undefined,
    postalCode: typed.postalCode || undefined,
  });
  if (!parsed.success) {
    // Keep every character they typed: retyping an address on a phone is
    // where checkouts die. The form re-renders populated.
    await writeDraft({ ...DROP_ORDER, addressInput: typed });
    const missing = parsed.error.issues
      .map((i) => String(i.path[0]))
      .filter((f) => f === "line1" || f === "city");
    redirect(
      `/signup?step=2&error=address${
        missing.length ? `&fields=${missing.join(",")}` : ""
      }`
    );
  }

  const draft = await readDraft();
  // ManualConnector coverage semantics (spec §7): LTE/5G instant-ok with
  // disclaimer; fibre needs a feasibility check.
  const { publishedPlanBySlug, publishedBundleBySlug } = await import(
    "@/lib/domain/catalogue"
  );
  let isFibre = false;
  if (draft.planSlug) {
    const plan = await publishedPlanBySlug(draft.planSlug);
    isFibre = plan?.category === "fibre";
  } else if (draft.bundleSlug) {
    const bundle = await publishedBundleBySlug(draft.bundleSlug);
    isFibre = Boolean(
      bundle?.items.some((i) => i.plan && i.plan.category === "fibre")
    );
  }

  await writeDraft({
    ...DROP_ORDER,
    address: parsed.data,
    addressInput: null,
    coverageResult: isFibre ? "fibre-feasibility" : "lte-ok",
    step: isFibre ? 2 : 3,
  });

  if (isFibre) {
    redirect("/signup?step=2&fibre=1");
  }
  redirect("/signup?step=3");
}

/** Fibre path: save everything as a lead and end warmly (spec §9.2). */
export async function fibreFeasibilityAction(form: FormData): Promise<void> {
  const name = String(form.get("name") ?? "").trim();
  const phone = String(form.get("phone") ?? "").trim();
  if (!name || !phone) redirect("/signup?step=2&fibre=1&error=contact");

  const draft = await readDraft();
  const addressText = draft.address
    ? [
        draft.address.line1,
        draft.address.suburb,
        draft.address.city,
        draft.address.postalCode,
      ]
        .filter(Boolean)
        .join(", ")
    : "";
  try {
    await createLead({
      name,
      phone,
      source: "web_coverage",
      interest: `Fibre signup: ${draft.planSlug ?? draft.bundleSlug ?? "unspecified plan"}`,
      addressText,
      feasibilityTask: true,
    });
  } catch (err) {
    const reason = classifyLeadError(err);
    if (reason === "system") {
      console.error("fibre feasibility lead capture failed:", err);
    }
    redirect(`/signup?step=2&fibre=1&error=${reason}`);
  }
  // Keep who we promised to come back to: the confirmation page repeats it
  // so the customer can see we captured the right number, and a later signup
  // starts prefilled.
  await writeDraft({
    contact: { name, phone, ...(draft.contact?.email ? { email: draft.contact.email } : {}) },
    abandonedLeadCaptured: true,
  });
  redirect("/signup/feasibility-promised");
}

// ------------------------------------------------------------------ step 3

const contactSchema = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().min(9).max(15),
  email: z.string().email().optional(),
});

export type OtpSendResult = WizardResult & {
  /** Seconds until the code on its way expires. */
  expiresIn?: number;
  /** Seconds before another code may be requested. */
  resendIn?: number;
};

/** A checkout has a person waiting on it, so every refusal offers a way out. */
const WHATSAPP_OFFER = " WhatsApp us and we will finish the order with you.";

/**
 * Send a code, or explain why not.
 *
 * The throttle is read before a code is spent: two taps on "Verify my number"
 * must not burn two of the five codes an hour this number gets, and the
 * countdown the customer sees has to belong to the code that is actually live,
 * not restart at five minutes because they tapped again.
 */
async function sendOtp(
  contact: { name: string; phone: string; email?: string },
  ip: string | null,
  options: { resend?: boolean } = {}
): Promise<OtpSendResult> {
  let throttle: OtpThrottleState;
  try {
    throttle = await otpThrottleState(contact.phone);
  } catch (err) {
    if (err instanceof PhoneFormatError) return { ok: false, error: err.message };
    throw err;
  }

  if (throttle.resendInSeconds > 0) {
    const ago = throttle.liveCodeSentSecondsAgo ?? 0;
    if (options.resend) {
      return {
        ok: false,
        error: `Give that code a moment to arrive. You can ask for a new one in ${throttle.resendInSeconds} seconds.`,
        resendIn: throttle.resendInSeconds,
      };
    }
    // A code for this number went out seconds ago and is still good: carry on
    // to the code screen rather than spending another one, with the countdown
    // set from when that code was actually sent.
    await writeDraft({
      contact,
      otpPending: true,
      otpSentAt: new Date(Date.now() - ago * 1000).toISOString(),
    });
    return {
      ok: true,
      expiresIn: Math.max(0, OTP_TTL_SECONDS - ago),
      resendIn: throttle.resendInSeconds,
    };
  }

  try {
    await requestOtp(contact.phone, ip);
  } catch (err) {
    if (err instanceof OtpRateLimitError) {
      // The library already works out how long until a slot frees up.
      return { ok: false, error: `${err.message}${WHATSAPP_OFFER}` };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not send the code",
    };
  }
  await writeDraft({
    contact,
    otpPending: true,
    otpSentAt: new Date().toISOString(),
  });
  return {
    ok: true,
    expiresIn: OTP_TTL_SECONDS,
    resendIn: OTP_RESEND_COOLDOWN_SECONDS,
  };
}

export async function requestSignupOtpAction(
  form: FormData
): Promise<OtpSendResult> {
  const parsed = contactSchema.safeParse({
    name: form.get("name"),
    phone: form.get("phone"),
    email: String(form.get("email") ?? "") || undefined,
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return {
      ok: false,
      error:
        field === "email"
          ? "That email address does not look right, or leave it blank."
          : field === "name"
            ? "Please give us your full name."
            : "Check your cellphone number, for example 082 123 4567.",
    };
  }
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0] ?? null;
  return sendOtp(parsed.data, ip);
}

/** "Send a new code". The cooldown is the library's, not a copy of it. */
export async function resendSignupOtpAction(): Promise<OtpSendResult> {
  const draft = await readDraft();
  if (!draft.contact) {
    return { ok: false, error: "Start with your details" };
  }
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0] ?? null;
  return sendOtp(draft.contact, ip, { resend: true });
}

/** Six digits. Checked before the code is spent, so a slip costs no tries. */
const codeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Codes are 6 digits. Check the message and try again.");

export async function verifySignupOtpAction(
  form: FormData
): Promise<WizardResult> {
  const code = String(form.get("code") ?? "");
  const popiaConsent = form.get("popiaConsent") === "on";
  const marketingWhatsapp = form.get("marketingWhatsapp") === "on";
  const marketingEmail = form.get("marketingEmail") === "on";

  if (!popiaConsent) {
    return {
      ok: false,
      error:
        "We need your consent to process your information, it's required to provide the service.",
    };
  }

  const draft = await readDraft();
  if (!draft.contact) return { ok: false, error: "Start with your details" };

  const parsedCode = codeSchema.safeParse(code);
  if (!parsedCode.success) {
    return { ok: false, error: parsedCode.error.issues[0]!.message };
  }

  // The library owns the diagnosis and the wording, so a customer who abandons
  // checkout and tries to sign in instead hears the same thing about the same
  // code: expired, locked, already used, or mistyped with N tries left.
  const verdict = await verifyOtp(draft.contact.phone, parsedCode.data);
  if (!verdict.ok) {
    return { ok: false, error: otpFailureMessage(verdict) };
  }

  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0] ?? null;

  // Create (or reuse) user + customer atomically (spec §10.1).
  const { userId, customerId } = await findOrCreateCustomer({
    phone: draft.contact.phone,
    name: draft.contact.name,
    email: draft.contact.email,
    popiaConsent,
    marketingWhatsapp,
    marketingEmail,
    ip,
    userAgent: hdrs.get("user-agent"),
  });

  await writeDraft({ phoneVerified: true, userId, customerId });

  // Authenticate the session immediately: mint a fresh OTP consumed straight
  // into the customer-otp provider (the just-verified phone is trusted).
  // Simplest correct approach: sign in with a one-time internal code.
  return { ok: true };
}

const idNumberSchema = z
  .string()
  .regex(/^\d{13}$|^[A-Za-z0-9]{6,12}$/, "Enter a valid SA ID or passport number");

async function processDocUpload(
  file: File,
  prefix: string,
  customerId: string
): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw new Error("File too large (max 10MB)");
  const input = Buffer.from(await file.arrayBuffer());
  let data = input;
  let ext = ".pdf";
  let contentType = "application/pdf";
  if (file.type !== "application/pdf") {
    // Normalise images to webp, keep private.
    data = await sharp(input)
      .rotate()
      .resize({ width: 2000, withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
    ext = ".webp";
    contentType = "image/webp";
  }
  const filePath = `rica/${customerId}/${prefix}-${randomFileName(ext)}`;
  await uploadFile("compliance", filePath, data, contentType);
  return filePath;
}

/**
 * Each document is saved to the draft the moment it lands, so a failure on
 * one never asks the customer to re-photograph the other.
 */
export async function submitRicaAction(form: FormData): Promise<WizardResult> {
  const draft = await readDraft();
  if (!draft.customerId) return { ok: false, error: "Verify your number first" };

  const idNumber = idNumberSchema.safeParse(
    String(form.get("idNumber") ?? "").replace(/\s/g, "")
  );
  if (!idNumber.success) {
    return { ok: false, error: idNumber.error.issues[0].message };
  }
  await writeDraft({ ricaIdNumber: idNumber.data });

  const idDoc = form.get("idDoc") as File | null;
  const poaDoc = form.get("poaDoc") as File | null;
  const failures: string[] = [];

  const save = async (
    file: File | null,
    prefix: "id" | "poa",
    key: "ricaIdDocPath" | "ricaPoaDocPath",
    label: string,
    alreadyHave: string | undefined
  ) => {
    if (!file || file.size === 0) {
      if (!alreadyHave) failures.push(`${label} is still needed`);
      return;
    }
    try {
      const path = await processDocUpload(file, prefix, draft.customerId!);
      await writeDraft({ [key]: path });
    } catch (err) {
      failures.push(
        `${label}: ${err instanceof Error ? err.message : "upload failed"}`
      );
    }
  };

  await save(idDoc, "id", "ricaIdDocPath", "ID document", draft.ricaIdDocPath);
  await save(
    poaDoc,
    "poa",
    "ricaPoaDocPath",
    "Proof of address",
    draft.ricaPoaDocPath
  );

  if (failures.length > 0) {
    return { ok: false, error: `${failures.join(". ")}.` };
  }
  return { ok: true };
}

function draftCart(draft: SignupDraftState) {
  return {
    planSlugs: draft.planSlug ? [draft.planSlug] : [],
    hardware: draft.hardware ?? [],
    bundleSlug: draft.bundleSlug ?? null,
  };
}

export type CheckoutBlock =
  | "verify"
  | "address"
  | "rica"
  | "cart"
  | "price_changed"
  | "already_paid"
  | "system";

export type CheckoutResult =
  | {
      ok: true;
      actionUrl: string;
      fields: Record<string, string>;
      orderNumber: string;
      totalCents: number;
    }
  | {
      ok: false;
      error: string;
      block: CheckoutBlock;
      orderNumber?: string;
      totalCents?: number;
    };

/**
 * The single pay button path. Prices the cart that is on screen right now,
 * rebuilds the order if anything changed since the customer last looked at
 * review, and only then builds the PayFast form. The amount PayFast collects
 * is always the amount the customer just read (spec §9.2, §6.2).
 */
export async function startCheckoutAction(
  expectedTotalCents: number
): Promise<CheckoutResult> {
  const draft = await readDraft();
  if (!draft.customerId || !draft.phoneVerified || !draft.contact) {
    return {
      ok: false,
      block: "verify",
      error: "Verify your cellphone number first",
    };
  }
  if (!draft.address) {
    return {
      ok: false,
      block: "address",
      error: "We still need the address where the service will live.",
    };
  }

  const cart = draftCart(draft);
  let priced;
  try {
    priced = await priceCart(cart);
  } catch (err) {
    const known =
      err instanceof Error && /no longer available|Nothing in the order/i.test(err.message);
    if (!known) console.error("checkout pricing failed:", err);
    return {
      ok: false,
      block: known ? "cart" : "system",
      error: known
        ? (err as Error).message
        : "We could not price your order just now. Nothing has been charged, please try again in a moment.",
    };
  }

  if (priced.totalDueNowCents !== expectedTotalCents) {
    return {
      ok: false,
      block: "price_changed",
      totalCents: priced.totalDueNowCents,
      error:
        "This price changed while you had the page open. Check the new total, then pay.",
    };
  }

  if (
    priced.requiresRica &&
    !(draft.ricaIdNumber && draft.ricaIdDocPath && draft.ricaPoaDocPath)
  ) {
    return {
      ok: false,
      block: "rica",
      error: "RICA details are required for SIM services",
    };
  }

  const { db } = await import("@/lib/db/client");
  const { orders } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");

  let orderId = draft.orderId;
  let orderNumber = draft.orderNumber;

  if (orderId) {
    const [existing] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!existing) {
      orderId = undefined;
      orderNumber = undefined;
    } else if (existing.status !== "pending_payment") {
      return {
        ok: false,
        block: "already_paid",
        orderNumber: existing.number,
        error: `Order ${existing.number} is already paid.`,
      };
    } else if (!(await orderMatchesCart(orderId, priced, draft.address))) {
      // The cart or the address moved after this order was built. Retire it
      // and price a fresh one rather than charging yesterday's basket.
      await cancelStaleOrder(orderId, "Cart changed before payment");
      orderId = undefined;
      orderNumber = undefined;
    }
  }

  if (!orderId) {
    try {
      const created = await createOrder({
        customerId: draft.customerId,
        cart,
        address: draft.address,
        channel: "web",
        expectedTotalCents: priced.totalDueNowCents,
        rica: priced.requiresRica
          ? {
              idNumber: draft.ricaIdNumber!,
              idDocPath: draft.ricaIdDocPath!,
              poaDocPath: draft.ricaPoaDocPath!,
            }
          : null,
      });
      orderId = created.orderId;
      orderNumber = created.orderNumber;
      await writeDraft({ orderId, orderNumber });
    } catch (err) {
      console.error("order creation failed:", err);
      return {
        ok: false,
        block: "system",
        error:
          err instanceof Error ? err.message : "Could not create the order",
      };
    }
  }

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) {
    return { ok: false, block: "system", error: "Order not found" };
  }
  // Last gate before money moves: the order, the priced cart and the figure
  // on the button must be the same number.
  if (
    order.totalCents !== priced.totalDueNowCents ||
    order.totalCents !== expectedTotalCents
  ) {
    return {
      ok: false,
      block: "price_changed",
      totalCents: priced.totalDueNowCents,
      error:
        "This price changed while you had the page open. Check the new total, then pay.",
    };
  }

  const { buildCheckout } = await import("@/lib/payfast");
  const nameParts = draft.contact.name.trim().split(/\s+/);
  const checkout = buildCheckout({
    paymentId: order.id,
    amountCents: order.totalCents,
    itemName: `Needd Connect order ${order.number}`,
    customerFirstName: nameParts[0],
    customerLastName: nameParts.slice(1).join(" ") || undefined,
    customerEmail: draft.contact.email,
    tokenize: true,
  });
  return {
    ok: true,
    ...checkout,
    orderNumber: orderNumber ?? order.number,
    totalCents: order.totalCents,
  };
}

/** After payment return: sign the verified customer into the portal. */
export async function signInVerifiedCustomerAction(): Promise<void> {
  const draft = await readDraft();
  if (!draft.phoneVerified || !draft.contact) redirect("/login");
  // The customer's phone was OTP-verified minutes ago in this same flow;
  // issue a fresh code internally and consume it to mint the session.
  const { issueInternalSession } = await import("@/lib/auth/internal-session");
  await issueInternalSession(draft.contact.phone);
  // The purchase is done: retire the draft so a later visit to /signup starts
  // a clean order instead of reviewing one that is already paid.
  const { clearDraft } = await import("@/lib/domain/signup");
  await clearDraft();
  redirect("/portal");
}
