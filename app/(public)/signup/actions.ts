"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import sharp from "sharp";
import { readDraft, writeDraft } from "@/lib/domain/signup";
import { requestOtp, verifyOtp, OtpRateLimitError } from "@/lib/auth/otp";
import { findOrCreateCustomer, createOrder, priceCart } from "@/lib/domain/orders";
import { createLead } from "@/lib/domain/leads";
import { uploadFile, randomFileName } from "@/lib/storage";

export type WizardResult = { ok: boolean; error?: string };

// ------------------------------------------------------------------ step 1

export async function chooseSelectionAction(form: FormData): Promise<void> {
  const planSlug = String(form.get("planSlug") ?? "") || undefined;
  const bundleSlug = String(form.get("bundleSlug") ?? "") || undefined;
  await writeDraft({
    planSlug: bundleSlug ? undefined : planSlug,
    bundleSlug,
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
  await writeDraft({ hardware: next });
  redirect("/signup?step=1");
}

export async function continueToAddressAction(form: FormData): Promise<void> {
  // Deep-linked selections (?plan= / ?bundle=) arrive as hidden fields —
  // cookies can only be written here, not during page render.
  const planSlug = String(form.get("planSlug") ?? "") || undefined;
  const bundleSlug = String(form.get("bundleSlug") ?? "") || undefined;
  const draft = await readDraft();
  const effectivePlan = planSlug ?? draft.planSlug;
  const effectiveBundle = bundleSlug ?? draft.bundleSlug;
  if (!effectivePlan && !effectiveBundle) redirect("/signup?step=1");
  await writeDraft({
    planSlug: effectiveBundle ? undefined : effectivePlan,
    bundleSlug: effectiveBundle,
    step: 2,
  });
  redirect("/signup?step=2");
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
  const parsed = addressSchema.safeParse({
    line1: form.get("line1"),
    line2: String(form.get("line2") ?? "") || undefined,
    suburb: String(form.get("suburb") ?? "") || undefined,
    city: form.get("city"),
    province: String(form.get("province") ?? "") || undefined,
    postalCode: String(form.get("postalCode") ?? "") || undefined,
  });
  if (!parsed.success) {
    redirect("/signup?step=2&error=address");
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
    address: parsed.data,
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
    });
  } catch {
    redirect("/signup?step=2&fibre=1&error=phone");
  }
  await writeDraft({ abandonedLeadCaptured: true });
  redirect("/signup/feasibility-promised");
}

// ------------------------------------------------------------------ step 3

const contactSchema = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().min(9).max(15),
  email: z.string().email().optional(),
});

export async function requestSignupOtpAction(
  form: FormData
): Promise<WizardResult> {
  const parsed = contactSchema.safeParse({
    name: form.get("name"),
    phone: form.get("phone"),
    email: String(form.get("email") ?? "") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: "Check your name and cellphone number" };
  }
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0] ?? null;
  try {
    await requestOtp(parsed.data.phone, ip);
  } catch (err) {
    if (err instanceof OtpRateLimitError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not send the code",
    };
  }
  await writeDraft({ contact: parsed.data, otpPending: true });
  return { ok: true };
}

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
        "We need your consent to process your information — it's required to provide the service.",
    };
  }

  const draft = await readDraft();
  if (!draft.contact) return { ok: false, error: "Start with your details" };

  const result = await verifyOtp(draft.contact.phone, code);
  if (!result.ok) {
    return { ok: false, error: "That code didn't match — try again." };
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

export async function submitRicaAction(form: FormData): Promise<WizardResult> {
  const draft = await readDraft();
  if (!draft.customerId) return { ok: false, error: "Verify your number first" };

  const idNumber = idNumberSchema.safeParse(
    String(form.get("idNumber") ?? "").replace(/\s/g, "")
  );
  if (!idNumber.success) {
    return { ok: false, error: idNumber.error.issues[0].message };
  }
  const idDoc = form.get("idDoc") as File | null;
  const poaDoc = form.get("poaDoc") as File | null;
  if (!idDoc || idDoc.size === 0 || !poaDoc || poaDoc.size === 0) {
    return {
      ok: false,
      error: "Both the ID document and proof of address are required",
    };
  }
  try {
    const [idDocPath, poaDocPath] = await Promise.all([
      processDocUpload(idDoc, "id", draft.customerId),
      processDocUpload(poaDoc, "poa", draft.customerId),
    ]);
    await writeDraft({
      ricaIdNumber: idNumber.data,
      ricaIdDocPath: idDocPath,
      ricaPoaDocPath: poaDocPath,
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Upload failed",
    };
  }
}

export async function createOrderAction(): Promise<
  WizardResult & { orderId?: string }
> {
  const draft = await readDraft();
  if (!draft.customerId || !draft.phoneVerified) {
    return { ok: false, error: "Verify your cellphone number first" };
  }
  if (!draft.address) return { ok: false, error: "We need your address" };

  const cart = {
    planSlugs: draft.planSlug ? [draft.planSlug] : [],
    hardware: draft.hardware ?? [],
    bundleSlug: draft.bundleSlug ?? null,
  };
  const priced = await priceCart(cart);
  if (
    priced.requiresRica &&
    !(draft.ricaIdNumber && draft.ricaIdDocPath && draft.ricaPoaDocPath)
  ) {
    return { ok: false, error: "RICA details are required for SIM services" };
  }

  try {
    const order = await createOrder({
      customerId: draft.customerId,
      cart,
      address: draft.address,
      channel: "web",
      rica: priced.requiresRica
        ? {
            idNumber: draft.ricaIdNumber!,
            idDocPath: draft.ricaIdDocPath!,
            poaDocPath: draft.ricaPoaDocPath!,
          }
        : null,
    });
    await writeDraft({ orderId: order.orderId, orderNumber: order.orderNumber });
    return { ok: true, orderId: order.orderId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not create the order",
    };
  }
}

/** After payment return: sign the verified customer into the portal. */
export async function signInVerifiedCustomerAction(): Promise<void> {
  const draft = await readDraft();
  if (!draft.phoneVerified || !draft.contact) redirect("/login");
  // The customer's phone was OTP-verified minutes ago in this same flow;
  // issue a fresh code internally and consume it to mint the session.
  const { issueInternalSession } = await import("@/lib/auth/internal-session");
  await issueInternalSession(draft.contact.phone);
  redirect("/portal");
}

/** Build the PayFast redirect form for the draft's order. */
export async function getCheckoutAction(): Promise<
  | { ok: true; actionUrl: string; fields: Record<string, string> }
  | { ok: false; error: string }
> {
  const draft = await readDraft();
  if (!draft.orderId || !draft.contact) {
    return { ok: false, error: "Order not ready" };
  }
  const { db } = await import("@/lib/db/client");
  const { orders } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const { buildCheckout } = await import("@/lib/payfast");
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, draft.orderId))
    .limit(1);
  if (!order) return { ok: false, error: "Order not found" };
  if (order.status !== "pending_payment") {
    return { ok: false, error: "This order has already been paid" };
  }
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
  return { ok: true, ...checkout };
}
