import "server-only";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Server-held proof that this browser verified an email code for a specific
 * quote.
 *
 * The verified customerId used to be handed to the browser and read straight
 * back off the finalize form, which meant anyone holding a share token could
 * skip the verify step entirely and accept the quote as any customer id they
 * cared to type. The id now travels in an httpOnly cookie, HMAC-signed over
 * the customer id, the quote's share token and an expiry, so the finalize
 * action only ever acts on an identity this server established minutes ago
 * for this exact quote.
 */

const COOKIE = "nc_quote_accept";
/** How long the address-and-documents step may take before re-verifying. */
const TTL_SECONDS = 30 * 60;

function secret(): string {
  return process.env.AUTH_SECRET ?? "dev-secret";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** Record the verified identity for this quote. Call only after verifyOtp. */
export async function setAcceptVerified(
  shareToken: string,
  customerId: string
): Promise<void> {
  const expiresAt = Date.now() + TTL_SECONDS * 1000;
  const payload = Buffer.from(
    JSON.stringify({ customerId, shareToken, expiresAt })
  ).toString("base64url");
  const jar = await cookies();
  jar.set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: TTL_SECONDS,
    path: "/",
  });
}

/**
 * The customerId this browser verified for this quote, or null when there is
 * no proof: no cookie, a signature that does not check out, a different
 * quote's token, or a verification older than the TTL.
 */
export async function readAcceptVerified(
  shareToken: string
): Promise<string | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 1) return null;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as { customerId?: string; shareToken?: string; expiresAt?: number };
    if (
      typeof parsed.customerId !== "string" ||
      parsed.shareToken !== shareToken ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt < Date.now()
    ) {
      return null;
    }
    return parsed.customerId;
  } catch {
    return null;
  }
}
