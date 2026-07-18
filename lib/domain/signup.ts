import "server-only";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db/client";
import { signupDrafts } from "@/lib/db/schema";

/**
 * Server-held signup draft (spec §9.2): state survives refresh, keyed by an
 * opaque cookie. The browser never holds the draft itself.
 */

const COOKIE = "nc_signup";

export interface SignupDraftState {
  step?: 1 | 2 | 3;
  planSlug?: string;
  bundleSlug?: string;
  hardware?: { sku: string; qty: number }[];
  address?: {
    line1: string;
    line2?: string;
    suburb?: string;
    city: string;
    province?: string;
    postalCode?: string;
  };
  coverageResult?: "lte-ok" | "fibre-feasibility";
  contact?: { name: string; phone: string; email?: string };
  otpPending?: boolean;
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
  patch: Partial<SignupDraftState>
): Promise<SignupDraftState> {
  const key = await getDraftKey();
  const [existing] = await db
    .select()
    .from(signupDrafts)
    .where(eq(signupDrafts.draftKey, key))
    .limit(1);
  const next = { ...((existing?.state as SignupDraftState) ?? {}), ...patch };
  if (existing) {
    await db
      .update(signupDrafts)
      .set({ state: next })
      .where(eq(signupDrafts.draftKey, key));
  } else {
    await db.insert(signupDrafts).values({ draftKey: key, state: next });
  }
  return next;
}

export async function clearDraft(): Promise<void> {
  const jar = await cookies();
  const key = jar.get(COOKIE)?.value;
  if (key) {
    await db.delete(signupDrafts).where(eq(signupDrafts.draftKey, key));
    jar.delete(COOKIE);
  }
}
