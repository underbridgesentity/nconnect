"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
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
  emailTarget,
  isValidEmail,
  normalizeEmail,
  OtpRateLimitError,
  EmailFormatError,
  OTP_TTL_SECONDS,
  OTP_RESEND_COOLDOWN_SECONDS,
  type OtpTarget,
  type OtpThrottleState,
} from "@/lib/auth/otp";
import {
  checkEmailAvailability,
  emailTakenMessage,
} from "@/lib/auth/customer-account";
import {
  findOrCreateCustomer,
  createOrder,
  priceCart,
  orderMatchesCart,
  cancelStaleOrder,
} from "@/lib/domain/orders";
import { createLead } from "@/lib/domain/leads";
import { uploadFile, randomFileName } from "@/lib/storage";
// Type only, so the schema is not pulled into this module at runtime: the
// database imports here are deliberately dynamic.
import type { orders as ordersTable } from "@/lib/db/schema";

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
  // Optional here, unlike at signup: this is a lead, not an account, and a
  // feasibility answer can be delivered on the number alone. Captured when it
  // is given so the reply can go by email, which is the channel that carries
  // everything once the order is real.
  const rawEmail = String(form.get("email") ?? "").trim();
  const email = rawEmail && isValidEmail(rawEmail) ? normalizeEmail(rawEmail) : null;
  if (!name || !phone) redirect("/signup?step=2&fibre=1&error=contact");
  if (rawEmail && !email) redirect("/signup?step=2&fibre=1&error=email");

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
      email,
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
  const carriedEmail = email ?? draft.contact?.email;
  await writeDraft({
    contact: { name, phone, ...(carriedEmail ? { email: carriedEmail } : {}) },
    abandonedLeadCaptured: true,
  });
  redirect("/signup/feasibility-promised");
}

// ------------------------------------------------------------------ step 3

/**
 * Who is buying.
 *
 * Email is the credential: it is what the one-time code goes to, what the
 * account is keyed on and where every order update lands. The cellphone number
 * stays required because a SIM cannot be activated without one under RICA, it
 * simply is not how anybody signs in any more.
 */
const contactSchema = z.object({
  name: z.string().min(2).max(120),
  email: z
    .string()
    .trim()
    .refine(isValidEmail, "Enter a valid email address")
    .transform(normalizeEmail),
  phone: z.string().min(9).max(15),
});

type SignupContact = z.infer<typeof contactSchema>;

/**
 * The answer to "send a code".
 *
 * A union rather than one optional-everything shape, because the countdown on
 * the code screen is only meaningful when a code actually went out. With both
 * windows required on the sent branch, the client renders the server's numbers
 * or nothing, and cannot quietly fall back to a second copy of the limits that
 * drifts the day one of them changes.
 */
export type OtpSendResult =
  | {
      ok: true;
      /** Seconds until the code on its way expires. */
      expiresIn: number;
      /** Seconds before another code may be requested. */
      resendIn: number;
    }
  | {
      ok: false;
      error?: string;
      /** Set when the refusal is a cooldown, so the button can count down. */
      resendIn?: number;
    };

/** A checkout has a person waiting on it, so every refusal offers a way out. */
const WHATSAPP_OFFER = " WhatsApp us and we will finish the order with you.";

/**
 * Send a code, or explain why not.
 *
 * The throttle is read before a code is spent: two taps on "Email me a code"
 * must not burn two of the five codes an hour this address gets, and the
 * countdown the customer sees has to belong to the code that is actually live,
 * not restart at five minutes because they tapped again.
 */
async function sendOtp(
  contact: SignupContact,
  ip: string | null,
  options: { resend?: boolean } = {}
): Promise<OtpSendResult> {
  let target: OtpTarget;
  try {
    target = emailTarget(contact.email);
  } catch (err) {
    if (err instanceof EmailFormatError) return { ok: false, error: err.message };
    throw err;
  }

  /*
   * Ask before a code goes out, on EVERY path that can send one. users.email
   * is uniquely indexed on lower(email), so an address already spoken for
   * cannot become a second account: sending a code first would only walk the
   * customer up to a failed insert mid-checkout.
   *
   * An address already held by a *customer* is not an error. It is somebody
   * buying a second service, and the code they are about to receive proves the
   * address is theirs, so checkout carries on and the existing account is
   * reused. A staff login is the one that has to stop here, and it has to stop
   * here rather than only in requestSignupOtpAction: the fibre lead form also
   * writes a contact into the draft, and the resend action sends to whatever
   * the draft holds.
   */
  const availability = await checkEmailAvailability(contact.email);
  if (
    availability.status === "invalid" ||
    (availability.status === "taken" && availability.by === "staff")
  ) {
    return { ok: false, error: emailTakenMessage(availability) };
  }

  let throttle: OtpThrottleState;
  try {
    throttle = await otpThrottleState(target);
  } catch (err) {
    if (err instanceof EmailFormatError) return { ok: false, error: err.message };
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
    // A code for this address went out seconds ago and is still good: carry on
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
    await requestOtp(target, ip);
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
    email: form.get("email"),
    phone: form.get("phone"),
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return {
      ok: false,
      error:
        field === "email"
          ? "That email address does not look right. We send your code there, so it has to be one you can open."
          : field === "name"
            ? "Please give us your full name."
            : "Check your cellphone number, for example 082 123 4567.",
    };
  }

  // The staff-address and validity gate lives in sendOtp itself, so this
  // path, the resend path and any contact the fibre lead form wrote into the
  // draft all pass through the same check.
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0] ?? null;
  return sendOtp(parsed.data, ip);
}

/** "Send a new code". The cooldown is the library's, not a copy of it. */
export async function resendSignupOtpAction(): Promise<OtpSendResult> {
  const draft = await readDraft();
  const contact = draftContact(draft);
  if (!contact) {
    return { ok: false, error: "Start with your details" };
  }
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0] ?? null;
  return sendOtp(contact, ip, { resend: true });
}

/**
 * The draft's contact, but only once it carries an email address.
 *
 * The stored shape still allows a contact without one: the fibre feasibility
 * form captures a name and a number long before anybody has an account. Signup
 * cannot send a code to that, so it is treated as "no contact yet" and the
 * customer is sent back to the details form rather than into a broken send.
 */
function draftContact(draft: SignupDraftState): SignupContact | null {
  const contact = draft.contact;
  if (!contact?.email) return null;
  return { name: contact.name, email: contact.email, phone: contact.phone };
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
  const contact = draftContact(draft);
  if (!contact) return { ok: false, error: "Start with your details" };

  const parsedCode = codeSchema.safeParse(code);
  if (!parsedCode.success) {
    return { ok: false, error: parsedCode.error.issues[0]!.message };
  }

  // Re-check the address before the code is spent. The send-time gate can be
  // raced, and the draft's contact can be written by paths that never sent a
  // code at all; without this, findOrCreateCustomer would quietly attach a
  // customers row to a staff user. Checking first also means a doomed attempt
  // does not burn one of the customer's tries.
  const availability = await checkEmailAvailability(contact.email);
  if (
    availability.status === "invalid" ||
    (availability.status === "taken" && availability.by === "staff")
  ) {
    return { ok: false, error: emailTakenMessage(availability) };
  }

  // The library owns the diagnosis and the wording, so a customer who abandons
  // checkout and tries to sign in instead hears the same thing about the same
  // code: expired, locked, already used, or mistyped with N tries left.
  const verdict = await verifyOtp(
    { identifier: contact.email, channel: "email" },
    parsedCode.data
  );
  if (!verdict.ok) {
    return { ok: false, error: otpFailureMessage(verdict) };
  }

  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0] ?? null;

  // Create (or reuse) user + customer atomically (spec §10.1).
  //
  // The availability check before the code went out closes the ordinary
  // duplicate; this catch closes the race between that check and this insert,
  // and any address that slipped past it. Either way the customer reads a
  // sentence they can act on instead of a 500 with their card already out.
  let userId: string;
  let customerId: string;
  try {
    const account = await findOrCreateCustomer({
      phone: contact.phone,
      name: contact.name,
      email: contact.email,
      popiaConsent,
      marketingWhatsapp,
      marketingEmail,
      ip,
      userAgent: hdrs.get("user-agent"),
    });
    userId = account.userId;
    customerId = account.customerId;
  } catch (err) {
    console.error("signup account creation failed:", err);
    const duplicateEmail =
      err instanceof Error && /users_email_lower_unique|duplicate key/i.test(err.message);
    return {
      ok: false,
      error: duplicateEmail
        ? emailTakenMessage({
            status: "taken",
            email: contact.email,
            by: "customer",
            userId: "",
          })
        : "We could not finish creating your account just now. Nothing has been charged, please try again in a moment.",
    };
  }

  // `phoneVerified` is the draft's long-standing name for "this person proved
  // who they are and the account exists". What they prove now is the email
  // address, not the number. See needsCoordination: the key wants renaming
  // once the flows that read it move together.
  await writeDraft({ phoneVerified: true, userId, customerId });

  return { ok: true };
}

const idNumberSchema = z
  .string()
  .regex(/^\d{13}$|^[A-Za-z0-9]{6,12}$/, "Enter a valid SA ID or passport number");

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
async function processDocUpload(
  file: File,
  prefix: string,
  customerId: string
): Promise<string> {
  const sharp = (await import("sharp")).default;
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
  if (!draft.customerId) {
    return { ok: false, error: "Verify your email address first" };
  }

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

/** Order statuses, as the database defines them. */
type OrderStatusValue = (typeof ordersTable.$inferSelect)["status"];

/**
 * What to tell a customer whose draft still points at an order that has
 * already been paid for.
 *
 * Every status is written out, so adding one to the enum stops this file
 * compiling rather than quietly inheriting somebody else's sentence. It used
 * to be a single `status !== "pending_payment"` test answering "Order N is
 * already paid", which caught `cancelled` as well and told a customer who had
 * paid nothing at all that their money was in. Cancelled is handled by the
 * caller instead, by pricing a fresh order.
 */
function paidOrderMessage(
  status: Exclude<OrderStatusValue, "pending_payment" | "cancelled">,
  orderNumber: string
): string {
  switch (status) {
    case "paid":
      return `Order ${orderNumber} is paid, so there is nothing more to pay on it. Open your portal to follow it, or start a new order below.`;
    case "processing":
      return `Order ${orderNumber} is paid and we are preparing it now. Open your portal to follow it, or start a new order below.`;
    case "fulfilled":
      return `Order ${orderNumber} is paid and already complete. Open your portal to see it, or start a new order below.`;
  }
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
  const contact = draftContact(draft);
  if (!draft.customerId || !draft.phoneVerified || !contact) {
    return {
      ok: false,
      block: "verify",
      error: "Verify your email address first",
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
    } else if (existing.status === "cancelled") {
      // Not a cent was ever taken against a cancelled order. This flow is what
      // cancels them: the branch below retires the order whenever the basket
      // or the address changed, and if building its replacement then failed,
      // the draft is left pointing at the cancelled one. Reporting that as
      // "already paid" was the exact opposite of the truth, so drop the
      // reference and price a fresh order from the cart on screen.
      await writeDraft(DROP_ORDER);
      orderId = undefined;
      orderNumber = undefined;
    } else if (existing.status !== "pending_payment") {
      return {
        ok: false,
        block: "already_paid",
        orderNumber: existing.number,
        // No totalCents: on this branch it would be the total of an order
        // already settled, and the only place it could land on screen is
        // beside the words "still to pay".
        error: paidOrderMessage(existing.status, existing.number),
      };
    } else if (!(await orderMatchesCart(orderId, priced, draft.address))) {
      // The cart or the address moved after this order was built. Retire it
      // and price a fresh one rather than charging yesterday's basket.
      await cancelStaleOrder(orderId, "Cart changed before payment");
      // Forget it in the same breath as retiring it. If creating the
      // replacement below fails, the next attempt must not find a cancelled
      // order id sitting in the draft.
      await writeDraft(DROP_ORDER);
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
  const nameParts = contact.name.trim().split(/\s+/);
  const checkout = buildCheckout({
    paymentId: order.id,
    amountCents: order.totalCents,
    itemName: `Needd Connect order ${order.number}`,
    customerFirstName: nameParts[0],
    customerLastName: nameParts.slice(1).join(" ") || undefined,
    customerEmail: contact.email,
    tokenize: true,
  });
  return {
    ok: true,
    ...checkout,
    orderNumber: orderNumber ?? order.number,
    totalCents: order.totalCents,
  };
}

/**
 * After payment return: sign the verified customer into the portal.
 *
 * The verified flag alone is not enough to mint a session. The draft cookie
 * lives for seven days, so a checkout abandoned after the email code but
 * before payment would leave a cookie behind that was password-equivalent on
 * any shared machine. Issuance is therefore bound to what this button
 * actually means on the success page: the draft's own order exists, belongs
 * to the draft's customer, and has been paid. Anyone without that, including
 * a stale cookie, goes to /login and proves the address with a fresh code.
 */
export async function signInVerifiedCustomerAction(): Promise<void> {
  const draft = await readDraft();
  const contact = draftContact(draft);
  if (!draft.phoneVerified || !contact || !draft.customerId || !draft.orderId) {
    redirect("/login");
  }

  const { db } = await import("@/lib/db/client");
  const { orders } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const [order] = await db
    .select({ customerId: orders.customerId, status: orders.status })
    .from(orders)
    .where(eq(orders.id, draft.orderId))
    .limit(1);
  const paid =
    order &&
    order.customerId === draft.customerId &&
    (order.status === "paid" ||
      order.status === "processing" ||
      order.status === "fulfilled");
  if (!paid) redirect("/login");

  // The customer's email address was OTP-verified in this same flow and the
  // order is confirmed paid; issue a fresh code internally and consume it to
  // mint the session.
  const { issueInternalSession } = await import("@/lib/auth/internal-session");
  await issueInternalSession(contact.email);
  // The purchase is done: retire the draft so a later visit to /signup starts
  // a clean order instead of reviewing one that is already paid.
  const { clearDraft } = await import("@/lib/domain/signup");
  await clearDraft();
  redirect("/portal");
}
