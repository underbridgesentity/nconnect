import "server-only";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { ZodError } from "zod";
import { db } from "@/lib/db/client";
import { signupDrafts } from "@/lib/db/schema";

/**
 * Server-held signup draft (spec §9.2): state survives refresh, keyed by an
 * opaque cookie. The browser never holds the draft itself.
 */

const COOKIE = "nc_signup";

export interface SignupAddress {
  line1: string;
  line2?: string;
  suburb?: string;
  city: string;
  province?: string;
  postalCode?: string;
}

export interface SignupDraftState {
  step?: 1 | 2 | 3;
  planSlug?: string;
  bundleSlug?: string;
  hardware?: { sku: string; qty: number }[];
  address?: SignupAddress;
  /**
   * Whatever the customer last typed into the address form, valid or not.
   * Kept so a validation error can re-render the form populated instead of
   * asking a phone user to retype the whole address.
   */
  addressInput?: Partial<SignupAddress>;
  coverageResult?: "lte-ok" | "fibre-feasibility";
  contact?: { name: string; phone: string; email?: string };
  otpPending?: boolean;
  /** ISO instant the last OTP was sent: drives the resend cooldown + expiry. */
  otpSentAt?: string;
  phoneVerified?: boolean;
  userId?: string;
  customerId?: string;
  popiaConsent?: boolean;
  marketingWhatsapp?: boolean;
  marketingEmail?: boolean;
  ricaIdNumber?: string;
  ricaIdDocPath?: string;
  ricaPoaDocPath?: string;
  orderId?: string;
  orderNumber?: string;
  abandonedLeadCaptured?: boolean;
}

/**
 * A patch may set a key, or clear it with `null`. Clearing matters: the order
 * pointer has to disappear the moment the cart or the address changes, so the
 * amount we charge can never drift from the amount on screen.
 */
export type SignupDraftPatch = {
  [K in keyof SignupDraftState]?: SignupDraftState[K] | null;
};

/** Everything that describes what is being bought, cleared as a set. */
const CART_KEYS = [
  "planSlug",
  "bundleSlug",
  "hardware",
  "address",
  "addressInput",
  "coverageResult",
  "orderId",
  "orderNumber",
] as const satisfies readonly (keyof SignupDraftState)[];

export async function getDraftKey(): Promise<string> {
  const jar = await cookies();
  let key = jar.get(COOKIE)?.value;
  if (!key) {
    key = randomBytes(18).toString("base64url");
    jar.set(COOKIE, key, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });
  }
  return key;
}

export async function readDraft(): Promise<SignupDraftState> {
  const jar = await cookies();
  const key = jar.get(COOKIE)?.value;
  if (!key) return {};
  const [row] = await db
    .select()
    .from(signupDrafts)
    .where(eq(signupDrafts.draftKey, key))
    .limit(1);
  return (row?.state as SignupDraftState) ?? {};
}

export async function writeDraft(
  patch: SignupDraftPatch
): Promise<SignupDraftState> {
  const key = await getDraftKey();
  const [existing] = await db
    .select()
    .from(signupDrafts)
    .where(eq(signupDrafts.draftKey, key))
    .limit(1);
  const merged: Record<string, unknown> = {
    ...((existing?.state as SignupDraftState) ?? {}),
  };
  for (const [k, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete merged[k];
    else merged[k] = value;
  }
  if (existing) {
    await db
      .update(signupDrafts)
      .set({ state: merged })
      .where(eq(signupDrafts.draftKey, key));
  } else {
    await db.insert(signupDrafts).values({ draftKey: key, state: merged });
  }
  return merged as SignupDraftState;
}

/**
 * Drop the order pointer. Called from every action that changes what is in
 * the cart or where it is going, so the next checkout prices and creates a
 * fresh order rather than charging a stale one.
 */
export async function clearDraftOrder(): Promise<void> {
  await writeDraft({ orderId: null, orderNumber: null });
}

/**
 * Start a fresh purchase while keeping who the customer is. Used after a
 * completed order so an existing customer can buy a second service without
 * being dropped back into the order they already paid for.
 */
export async function startNewDraftOrder(): Promise<void> {
  const patch: SignupDraftPatch = { step: 1 };
  for (const k of CART_KEYS) patch[k] = null;
  await writeDraft(patch);
}

// ------------------------------------------------------- lead capture errors

export type LeadFailure = "phone" | "name" | "system";

/**
 * Why did lead capture fail? Telling a prospect with a perfectly good number
 * that their number is wrong, because the database blinked, loses the lead
 * silently and hides the outage. Only a genuine phone-format failure gets the
 * phone message.
 */
export function classifyLeadError(err: unknown): LeadFailure {
  if (err instanceof ZodError) {
    const field = err.issues[0]?.path[0];
    if (field === "phone") return "phone";
    if (field === "name") return "name";
    return "system";
  }
  if (
    err instanceof Error &&
    err.message === "Enter a valid South African cellphone number"
  ) {
    return "phone";
  }
  return "system";
}

/** Server action / route handler only: cookies cannot be deleted in render. */
export async function clearDraft(): Promise<void> {
  const jar = await cookies();
  const key = jar.get(COOKIE)?.value;
  if (key) {
    await db.delete(signupDrafts).where(eq(signupDrafts.draftKey, key));
    jar.delete(COOKIE);
  }
}
