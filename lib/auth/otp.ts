import "server-only";
import { randomInt } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { otpCodes } from "@/lib/db/schema";
import { sha256, safeEqualHex } from "@/lib/crypto";
import { getSmsAdapter } from "@/lib/notify/sms";
import { sendWhatsAppTemplate, whatsappEnabled } from "@/lib/notify/whatsapp";

/**
 * OTP service (spec §3.2, §10.1): 6 digits, hashed at rest, 5-minute expiry,
 * rate-limited per phone and per IP. Delivery: WhatsApp first, SMS fallback,
 * console driver in dev.
 *
 * Verification answers with a discriminated result rather than a bare boolean.
 * "Wrong code", "that code expired", "you have used up your tries" and "we
 * never sent you one" are four different situations for the person holding the
 * phone, and a screen that cannot tell them apart can only offer one vague
 * apology. Callers get the verdict, plus the tries left where that is the
 * useful next fact, and write honest copy from it.
 */

export const OTP_TTL_SECONDS = 5 * 60;
/** Minimum gap between codes to the same number, enforced by callers. */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_MAX_VERIFY_ATTEMPTS = 5;
export const OTP_MAX_PER_PHONE_PER_HOUR = 5;
export const OTP_MAX_PER_IP_PER_HOUR = 15;

const OTP_TTL_MS = OTP_TTL_SECONDS * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * A number we cannot dial. Typed so a caller can tell "you typed the number
 * wrong" apart from "our SMS provider is down" without matching on message
 * strings. The offending input is deliberately not attached: it is personal
 * information and errors end up in logs.
 */
export class PhoneFormatError extends Error {
  constructor(message = "Enter a valid South African cellphone number") {
    super(message);
    this.name = "PhoneFormatError";
  }
}

export class OtpRateLimitError extends Error {
  /** Which ceiling was hit: this number, or this internet connection. */
  readonly scope: "phone" | "ip";
  /** Roughly how long until a slot frees up, when we can work it out. */
  readonly retryAfterMinutes: number | null;

  constructor(scope: "phone" | "ip", retryAfterMinutes: number | null = null) {
    super(
      scope === "phone"
        ? retryAfterMinutes
          ? `That is as many codes as we can send to this number for now. Try again in about ${retryAfterMinutes} minute${retryAfterMinutes === 1 ? "" : "s"}.`
          : "That is as many codes as we can send to this number for now. Please try again a bit later."
        : "That is as many codes as we can send from this connection for now. Please try again a bit later."
    );
    this.name = "OtpRateLimitError";
    this.scope = scope;
    this.retryAfterMinutes = retryAfterMinutes;
  }
}

/**
 * Why a code was rejected. `ok` rides along on every variant so the older
 * `if (!result.ok)` call sites keep reading, while `status` carries the detail
 * a screen needs to say something true.
 */
export type OtpVerifyResult =
  | { ok: true; status: "ok"; phone: string }
  /** Right code, wrong digits. `attemptsRemaining` is always 1 or more. */
  | {
      ok: false;
      status: "mismatch";
      phone: string;
      attemptsRemaining: number;
    }
  /** Tries exhausted: this code is dead even if they now type it correctly. */
  | { ok: false; status: "locked"; phone: string; attemptsRemaining: 0 }
  /** A code was sent, but more than five minutes ago. */
  | { ok: false; status: "expired"; phone: string }
  /** Nothing to check against: never sent, or already signed in with. */
  | { ok: false; status: "none"; phone: string; alreadyUsed: boolean };

export type OtpVerifyStatus = OtpVerifyResult["status"];

/** The refused half of a verdict: everything a refusal message needs. */
export type OtpVerifyFailure = Extract<OtpVerifyResult, { ok: false }>;

/**
 * The one wording for a refused code.
 *
 * Sign-in, signup and quote acceptance reject codes for the same four reasons,
 * and someone who gives up on one screen and tries another must not be told two
 * different stories about the same code. Each caller reads the verdict and
 * hands it here rather than re-deriving the diagnosis from the database with
 * its own copy of the limits, which is how the three screens drifted apart in
 * the first place. Change a limit above and every screen follows.
 */
export function otpFailureMessage(verdict: OtpVerifyFailure): string {
  switch (verdict.status) {
    case "mismatch": {
      const left = verdict.attemptsRemaining;
      return `That code is not right. ${left} ${left === 1 ? "try" : "tries"} left before you need a new code.`;
    }
    case "locked":
      return "That was the last try on that code. Send a new code and you can start again.";
    case "expired": {
      const minutes = Math.max(1, Math.round(OTP_TTL_SECONDS / 60));
      return `That code has expired, codes last ${minutes} minute${minutes === 1 ? "" : "s"}. Send a new code.`;
    }
    case "none":
      return verdict.alreadyUsed
        ? "That code has already been used. Send a new code and try again."
        : "We have no code waiting for that number. Send a new code and try again.";
  }
}

/** South African numbers to E.164. Accepts 0821234567, 27821234567, +27821234567. */
export function normalizePhone(input: string): string {
  const digits = input.replace(/[\s()-]/g, "");
  if (/^\+27\d{9}$/.test(digits)) return digits;
  if (/^27\d{9}$/.test(digits)) return `+${digits}`;
  if (/^0\d{9}$/.test(digits)) return `+27${digits.slice(1)}`;
  throw new PhoneFormatError();
}

/** Non-throwing variant, for zod refinements and search boxes. */
export function isValidPhone(input: string): boolean {
  try {
    normalizePhone(input);
    return true;
  } catch {
    return false;
  }
}

/** "+27821234567" -> "082 123 4567", for reading a number back to its owner. */
export function formatPhoneForDisplay(phone: string): string {
  const match = /^\+27(\d{2})(\d{3})(\d{4})$/.exec(phone);
  if (!match) return phone;
  return `0${match[1]} ${match[2]} ${match[3]}`;
}

/**
 * How long until the per-phone hourly ceiling frees a slot, so we can tell
 * someone when to come back instead of "wait a while". A slot opens when the
 * oldest code still inside the window ages out of it.
 */
async function phoneRetryAfterMinutes(phone: string): Promise<number | null> {
  try {
    const rows = await db
      .select({ createdAt: otpCodes.createdAt })
      .from(otpCodes)
      .where(
        and(
          eq(otpCodes.phone, phone),
          gt(otpCodes.createdAt, new Date(Date.now() - HOUR_MS))
        )
      )
      .orderBy(otpCodes.createdAt)
      .limit(50);
    const index = rows.length - OTP_MAX_PER_PHONE_PER_HOUR;
    const blocking = rows[index >= 0 ? index : 0];
    if (!blocking) return null;
    const freesAt = blocking.createdAt.getTime() + HOUR_MS;
    return Math.max(1, Math.ceil((freesAt - Date.now()) / 60000));
  } catch {
    return null;
  }
}

export type OtpThrottleState = {
  /** Seconds before another code may be sent to this number, 0 when free. */
  resendInSeconds: number;
  /** Age of the code still waiting to be used, null when there isn't one. */
  liveCodeSentSecondsAgo: number | null;
  /** True when the hourly ceiling is reached, whatever the cooldown says. */
  hourlyLimitReached: boolean;
  /** Minutes until the hourly ceiling frees a slot, when known. */
  retryAfterMinutes: number | null;
};

/**
 * What the "Send a new code" button is allowed to do right now. Read before
 * sending, so the screen can show a countdown instead of burning one of the
 * five codes an hour on a customer who tapped twice.
 *
 * The cooldown hangs off the code still waiting to be used, not off the last
 * row written: once a code has been used or has expired, asking for another is
 * a reasonable thing to want, and the hourly ceiling still bounds it.
 */
export async function otpThrottleState(
  rawPhone: string
): Promise<OtpThrottleState> {
  const phone = normalizePhone(rawPhone);
  const now = Date.now();
  const rows = await db
    .select({
      createdAt: otpCodes.createdAt,
      consumedAt: otpCodes.consumedAt,
      expiresAt: otpCodes.expiresAt,
    })
    .from(otpCodes)
    .where(
      and(
        eq(otpCodes.phone, phone),
        gt(otpCodes.createdAt, new Date(now - HOUR_MS))
      )
    )
    .orderBy(desc(otpCodes.createdAt))
    .limit(OTP_MAX_PER_PHONE_PER_HOUR + 1);

  const live = rows.find(
    (row) => !row.consumedAt && row.expiresAt.getTime() > now
  );
  const liveAge = live
    ? Math.max(0, Math.floor((now - live.createdAt.getTime()) / 1000))
    : null;
  const resendInSeconds =
    liveAge !== null && liveAge < OTP_RESEND_COOLDOWN_SECONDS
      ? OTP_RESEND_COOLDOWN_SECONDS - liveAge
      : 0;
  const hourlyLimitReached = rows.length >= OTP_MAX_PER_PHONE_PER_HOUR;

  return {
    resendInSeconds,
    liveCodeSentSecondsAgo: liveAge,
    hourlyLimitReached,
    retryAfterMinutes: hourlyLimitReached
      ? await phoneRetryAfterMinutes(phone)
      : null,
  };
}

export type OtpSendOutcome = {
  sent: true;
  channel: string;
  /** E.164, so callers can echo back the number the code actually went to. */
  phone: string;
  expiresInSeconds: number;
  resendInSeconds: number;
};

export async function requestOtp(
  rawPhone: string,
  ip: string | null
): Promise<OtpSendOutcome> {
  const phone = normalizePhone(rawPhone);
  const oneHourAgo = new Date(Date.now() - HOUR_MS);

  const [phoneCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(otpCodes)
    .where(and(eq(otpCodes.phone, phone), gt(otpCodes.createdAt, oneHourAgo)));
  if (phoneCount.n >= OTP_MAX_PER_PHONE_PER_HOUR) {
    throw new OtpRateLimitError("phone", await phoneRetryAfterMinutes(phone));
  }

  if (ip) {
    const [ipCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(otpCodes)
      .where(and(eq(otpCodes.ip, ip), gt(otpCodes.createdAt, oneHourAgo)));
    if (ipCount.n >= OTP_MAX_PER_IP_PER_HOUR) {
      throw new OtpRateLimitError("ip");
    }
  }

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await db.insert(otpCodes).values({
    phone,
    ip,
    codeHash: sha256(code),
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });

  const outcome = {
    sent: true as const,
    phone,
    expiresInSeconds: OTP_TTL_SECONDS,
    resendInSeconds: OTP_RESEND_COOLDOWN_SECONDS,
  };

  // WhatsApp first, SMS fallback (console driver in dev).
  if (whatsappEnabled()) {
    const wa = await sendWhatsAppTemplate({
      to: phone,
      template: "otp_login",
      bodyParams: [code],
    });
    if (wa.ok) return { ...outcome, channel: "whatsapp" };
  }
  const sms = getSmsAdapter();
  const result = await sms.send(
    phone,
    `${code} is your Needd Connect verification code. It expires in 5 minutes.`
  );
  if (!result.ok) {
    throw new Error(`Could not send the code: ${result.detail}`);
  }
  return { ...outcome, channel: `sms:${sms.name}` };
}

/**
 * Check a code against the newest live one for that number.
 *
 * `consume: false` peeks: the verdict is the same, but a correct code stays
 * usable for the caller's next step (signing in through the Auth.js provider,
 * which verifies it again for real). Attempts count failures only, so a peek
 * followed by a real verification never costs a try.
 */
export async function verifyOtp(
  rawPhone: string,
  code: string,
  options: { consume?: boolean } = {}
): Promise<OtpVerifyResult> {
  const consume = options.consume ?? true;
  const phone = normalizePhone(rawPhone);
  const now = new Date();

  const [live] = await db
    .select()
    .from(otpCodes)
    .where(
      and(
        eq(otpCodes.phone, phone),
        isNull(otpCodes.consumedAt),
        gt(otpCodes.expiresAt, now)
      )
    )
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);

  if (!live) {
    // Nothing live, so the newest record for the number explains why.
    const [latest] = await db
      .select({ consumedAt: otpCodes.consumedAt })
      .from(otpCodes)
      .where(eq(otpCodes.phone, phone))
      .orderBy(desc(otpCodes.createdAt))
      .limit(1);
    if (!latest) return { ok: false, status: "none", phone, alreadyUsed: false };
    if (latest.consumedAt) {
      return { ok: false, status: "none", phone, alreadyUsed: true };
    }
    return { ok: false, status: "expired", phone };
  }

  if (live.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
    return { ok: false, status: "locked", phone, attemptsRemaining: 0 };
  }

  if (!safeEqualHex(sha256(code), live.codeHash)) {
    // Guarded increment: two tabs guessing at once cannot share a try.
    const [bumped] = await db
      .update(otpCodes)
      .set({ attempts: sql`${otpCodes.attempts} + 1` })
      .where(
        and(
          eq(otpCodes.id, live.id),
          lt(otpCodes.attempts, OTP_MAX_VERIFY_ATTEMPTS)
        )
      )
      .returning({ attempts: otpCodes.attempts });
    const attemptsRemaining = bumped
      ? Math.max(0, OTP_MAX_VERIFY_ATTEMPTS - bumped.attempts)
      : 0;
    return attemptsRemaining > 0
      ? { ok: false, status: "mismatch", phone, attemptsRemaining }
      : { ok: false, status: "locked", phone, attemptsRemaining: 0 };
  }

  if (!consume) return { ok: true, status: "ok", phone };

  // Single-use: whoever wins the update owns the session, the loser is told
  // the code is spent rather than both being waved through.
  const [claimed] = await db
    .update(otpCodes)
    .set({ consumedAt: now })
    .where(and(eq(otpCodes.id, live.id), isNull(otpCodes.consumedAt)))
    .returning({ id: otpCodes.id });
  if (!claimed) {
    return { ok: false, status: "none", phone, alreadyUsed: true };
  }
  return { ok: true, status: "ok", phone };
}
