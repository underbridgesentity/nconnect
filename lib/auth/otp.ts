import "server-only";
import { randomInt } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { otpCodes } from "@/lib/db/schema";
import { sha256, safeEqualHex } from "@/lib/crypto";
import { sendEmail } from "@/lib/notify/email";
import { getSmsAdapter } from "@/lib/notify/sms";
import { sendWhatsAppTemplate, whatsappEnabled } from "@/lib/notify/whatsapp";

/**
 * OTP service (spec §3.2, §10.1): 6 digits, hashed at rest, 5-minute expiry,
 * rate-limited per identifier and per IP.
 *
 * A code is issued against a target: an identifier plus the channel it was sent
 * on. Email is the customer's sign-in credential; phone stays because RICA
 * requires a contactable number for any SIM-based service, and quote acceptance
 * still reaches people on it. The channel is part of the lookup everywhere, so a
 * code mailed to someone can never satisfy a challenge on their number or the
 * other way round: two channels, two independent proofs, no cross-talk.
 *
 * Verification answers with a discriminated result rather than a bare boolean.
 * "Wrong code", "that code expired", "you have used up your tries" and "we
 * never sent you one" are four different situations for the person waiting for
 * a code, and a screen that cannot tell them apart can only offer one vague
 * apology. Callers get the verdict, plus the tries left where that is the
 * useful next fact, and write honest copy from it.
 */

export const OTP_TTL_SECONDS = 5 * 60;
/** Minimum gap between codes to the same target, enforced by callers. */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_MAX_VERIFY_ATTEMPTS = 5;
export const OTP_MAX_PER_IDENTIFIER_PER_HOUR = 5;
export const OTP_MAX_PER_IP_PER_HOUR = 15;

const OTP_TTL_MS = OTP_TTL_SECONDS * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Where a code was sent. Part of the key: never inferred from the string. */
export type OtpChannel = "email" | "phone";

/**
 * Who a code is for. `identifier` is an email address when the channel is
 * email and an E.164 number when it is phone; every entry point normalises it
 * before it touches the database, so one person is always one row key.
 */
export type OtpTarget = {
  identifier: string;
  channel: OtpChannel;
};

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

/** The same idea for an address we cannot post to. */
export class EmailFormatError extends Error {
  constructor(message = "Enter a valid email address") {
    super(message);
    this.name = "EmailFormatError";
  }
}

export class OtpRateLimitError extends Error {
  /** Which ceiling was hit: this person, or this internet connection. */
  readonly scope: "identifier" | "ip";
  /** The channel the refused request was for, so copy can name it. */
  readonly channel: OtpChannel;
  /** Roughly how long until a slot frees up, when we can work it out. */
  readonly retryAfterMinutes: number | null;

  constructor(
    scope: "identifier" | "ip",
    channel: OtpChannel,
    retryAfterMinutes: number | null = null
  ) {
    super(rateLimitMessage(scope, channel, retryAfterMinutes));
    this.name = "OtpRateLimitError";
    this.scope = scope;
    this.channel = channel;
    this.retryAfterMinutes = retryAfterMinutes;
  }
}

/** The noun a customer would use for where their code went. */
function channelNoun(channel: OtpChannel): string {
  return channel === "email" ? "email address" : "number";
}

function rateLimitMessage(
  scope: "identifier" | "ip",
  channel: OtpChannel,
  retryAfterMinutes: number | null
): string {
  if (scope === "ip") {
    return "That is as many codes as we can send from this connection for now. Please try again a bit later.";
  }
  const noun = channelNoun(channel);
  return retryAfterMinutes
    ? `That is as many codes as we can send to this ${noun} for now. Try again in about ${retryAfterMinutes} minute${retryAfterMinutes === 1 ? "" : "s"}.`
    : `That is as many codes as we can send to this ${noun} for now. Please try again a bit later.`;
}

/**
 * Why a code was rejected. `ok` rides along on every variant so the older
 * `if (!result.ok)` call sites keep reading, while `status` carries the detail
 * a screen needs to say something true. Every variant repeats the target, so a
 * caller that hands the verdict on never has to remember what it asked about.
 */
export type OtpVerifyResult =
  | { ok: true; status: "ok"; identifier: string; channel: OtpChannel }
  /** Right code, wrong digits. `attemptsRemaining` is always 1 or more. */
  | {
      ok: false;
      status: "mismatch";
      identifier: string;
      channel: OtpChannel;
      attemptsRemaining: number;
    }
  /** Tries exhausted: this code is dead even if they now type it correctly. */
  | {
      ok: false;
      status: "locked";
      identifier: string;
      channel: OtpChannel;
      attemptsRemaining: 0;
    }
  /** A code was sent, but more than five minutes ago. */
  | { ok: false; status: "expired"; identifier: string; channel: OtpChannel }
  /** Nothing to check against: never sent, or already signed in with. */
  | {
      ok: false;
      status: "none";
      identifier: string;
      channel: OtpChannel;
      alreadyUsed: boolean;
    };

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
        : `We have no code waiting for that ${channelNoun(verdict.channel)}. Send a new code and try again.`;
  }
}

/* --------------------------------------------------------------- identifiers */

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
 * Trim, lowercase, and refuse anything that is not plausibly deliverable.
 *
 * Lowercasing is what makes the address a stable key: mail servers treat the
 * domain case-insensitively and every provider we deal with does the same for
 * the local part, so Thandi@Example.com and thandi@example.com are one person
 * and must be one account. The deliberately plain shape check (one @, a dot in
 * the domain, no spaces) rejects typing mistakes without pretending we can
 * validate an address offline; whether mail arrives is the mail server's answer
 * to give, and a code that never lands says it plainly enough.
 */
export function normalizeEmail(input: string): string {
  const email = input.trim().toLowerCase();
  if (email.length < 6 || email.length > 254) throw new EmailFormatError();
  if (/[\s<>,;"()[\]\\]/.test(email)) throw new EmailFormatError();
  const at = email.indexOf("@");
  if (at < 1 || at !== email.lastIndexOf("@")) throw new EmailFormatError();
  const domain = email.slice(at + 1);
  if (
    !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(
      domain
    )
  ) {
    throw new EmailFormatError();
  }
  if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(email.slice(0, at))) {
    throw new EmailFormatError();
  }
  if (email.slice(0, at).startsWith(".") || email.slice(0, at).endsWith(".")) {
    throw new EmailFormatError();
  }
  if (!/\.[a-z]{2,}$/.test(domain)) throw new EmailFormatError();
  return email;
}

/** Non-throwing variant, for zod refinements. */
export function isValidEmail(input: string): boolean {
  try {
    normalizeEmail(input);
    return true;
  } catch {
    return false;
  }
}

/** Normalise a target for its channel. Throws the channel's format error. */
export function normalizeOtpTarget(target: OtpTarget): OtpTarget {
  return target.channel === "email"
    ? { channel: "email", identifier: normalizeEmail(target.identifier) }
    : { channel: "phone", identifier: normalizePhone(target.identifier) };
}

/** Convenience constructors, so call sites read as what they are. */
export function emailTarget(rawEmail: string): OtpTarget {
  return { channel: "email", identifier: normalizeEmail(rawEmail) };
}

export function phoneTarget(rawPhone: string): OtpTarget {
  return { channel: "phone", identifier: normalizePhone(rawPhone) };
}

/** Read an identifier back to its owner, in the shape they typed it. */
export function formatIdentifierForDisplay(
  identifier: string,
  channel: OtpChannel
): string {
  return channel === "email" ? identifier : formatPhoneForDisplay(identifier);
}

/**
 * Does this stored code belong to the challenge being answered?
 *
 * The database query already filters on both columns; this is the same rule
 * expressed once, in code, and applied again to whatever comes back. It is
 * cheap, and it is the guarantee that matters most in this file: a code that
 * went to an email address must never sign anyone in on a phone challenge, or
 * the second channel becomes a weaker way into the same account. Keeping the
 * rule as a pure function means it can be tested without a database, which is
 * the only way it stays true.
 */
export function otpRowMatchesTarget(
  row: { identifier: string; channel: OtpChannel },
  target: OtpTarget
): boolean {
  return row.channel === target.channel && row.identifier === target.identifier;
}

/* ------------------------------------------------------------- rate limiting */

/**
 * Which ceiling, if any, a fresh request has hit. Pure, so the limits can be
 * tested without conjuring an hour of database rows.
 */
export function otpRateLimitVerdict(counts: {
  identifierInLastHour: number;
  ipInLastHour: number | null;
}): { limited: false } | { limited: true; scope: "identifier" | "ip" } {
  if (counts.identifierInLastHour >= OTP_MAX_PER_IDENTIFIER_PER_HOUR) {
    return { limited: true, scope: "identifier" };
  }
  if (
    counts.ipInLastHour !== null &&
    counts.ipInLastHour >= OTP_MAX_PER_IP_PER_HOUR
  ) {
    return { limited: true, scope: "ip" };
  }
  return { limited: false };
}

/**
 * How long until the hourly ceiling frees a slot, so we can tell someone when
 * to come back instead of "wait a while". A slot opens when the oldest code
 * still inside the window ages out of it. Pure; `createdAt` values may arrive
 * in any order.
 */
export function otpRetryAfterMinutes(
  createdAt: Date[],
  now: number = Date.now()
): number | null {
  if (createdAt.length === 0) return null;
  const inWindow = createdAt
    .filter((at) => at.getTime() > now - HOUR_MS)
    .sort((a, b) => a.getTime() - b.getTime());
  if (inWindow.length === 0) return null;
  const index = inWindow.length - OTP_MAX_PER_IDENTIFIER_PER_HOUR;
  const blocking = inWindow[index >= 0 ? index : 0];
  return Math.max(1, Math.ceil((blocking.getTime() + HOUR_MS - now) / 60000));
}

async function identifierRetryAfterMinutes(
  target: OtpTarget
): Promise<number | null> {
  try {
    const rows = await db
      .select({ createdAt: otpCodes.createdAt })
      .from(otpCodes)
      .where(
        and(
          eq(otpCodes.identifier, target.identifier),
          eq(otpCodes.channel, target.channel),
          gt(otpCodes.createdAt, new Date(Date.now() - HOUR_MS))
        )
      )
      .orderBy(otpCodes.createdAt)
      .limit(50);
    return otpRetryAfterMinutes(rows.map((row) => row.createdAt));
  } catch {
    return null;
  }
}

export type OtpThrottleState = {
  /** Seconds before another code may be sent to this target, 0 when free. */
  resendInSeconds: number;
  /** Age of the code still waiting to be used, null when there isn't one. */
  liveCodeSentSecondsAgo: number | null;
  /** True when the hourly ceiling is reached, whatever the cooldown says. */
  hourlyLimitReached: boolean;
  /** Minutes until the hourly ceiling frees a slot, when known. */
  retryAfterMinutes: number | null;
};

/**
 * The cooldown and ceiling, worked out from the rows for one target. Pure, so
 * the countdown a customer stares at can be tested directly.
 *
 * The cooldown hangs off the code still waiting to be used, not off the last
 * row written: once a code has been used or has expired, asking for another is
 * a reasonable thing to want, and the hourly ceiling still bounds it.
 */
export function otpThrottleFromRows(
  rows: { createdAt: Date; consumedAt: Date | null; expiresAt: Date }[],
  now: number = Date.now()
): Omit<OtpThrottleState, "retryAfterMinutes"> {
  const recent = rows
    .filter((row) => row.createdAt.getTime() > now - HOUR_MS)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const live = recent.find(
    (row) => !row.consumedAt && row.expiresAt.getTime() > now
  );
  const liveAge = live
    ? Math.max(0, Math.floor((now - live.createdAt.getTime()) / 1000))
    : null;
  return {
    resendInSeconds:
      liveAge !== null && liveAge < OTP_RESEND_COOLDOWN_SECONDS
        ? OTP_RESEND_COOLDOWN_SECONDS - liveAge
        : 0,
    liveCodeSentSecondsAgo: liveAge,
    hourlyLimitReached: recent.length >= OTP_MAX_PER_IDENTIFIER_PER_HOUR,
  };
}

/**
 * What the "Send a new code" button is allowed to do right now. Read before
 * sending, so the screen can show a countdown instead of burning one of the
 * five codes an hour on a customer who tapped twice.
 */
export async function otpThrottleState(
  target: OtpTarget
): Promise<OtpThrottleState> {
  const normalized = normalizeOtpTarget(target);
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
        eq(otpCodes.identifier, normalized.identifier),
        eq(otpCodes.channel, normalized.channel),
        gt(otpCodes.createdAt, new Date(now - HOUR_MS))
      )
    )
    .orderBy(desc(otpCodes.createdAt))
    .limit(OTP_MAX_PER_IDENTIFIER_PER_HOUR + 1);

  const state = otpThrottleFromRows(rows, now);
  return {
    ...state,
    retryAfterMinutes: state.hourlyLimitReached
      ? await identifierRetryAfterMinutes(normalized)
      : null,
  };
}

/* ------------------------------------------------------------------ sending */

export type OtpSendOutcome = {
  sent: true;
  /** The channel the code went out on. */
  channel: OtpChannel;
  /** How it was carried: "email", "whatsapp", "sms:console". */
  via: string;
  /** Normalised, so callers can echo back exactly where the code went. */
  identifier: string;
  expiresInSeconds: number;
  resendInSeconds: number;
};

const CODE_LIFETIME_WORDS = `${Math.round(OTP_TTL_SECONDS / 60)} minutes`;

function otpEmailBody(code: string): { text: string; html: string } {
  const text = [
    `${code} is your Needd Connect sign-in code.`,
    "",
    `It expires in ${CODE_LIFETIME_WORDS}. If you did not ask for it, you can ignore this email and nothing will change.`,
    "",
    "Needd Connect, one provider, one bill, local support.",
  ].join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#18181b">
  <p style="margin:0 0 16px">Here is your Needd Connect sign-in code.</p>
  <p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:6px">${code}</p>
  <p style="margin:0 0 16px">It expires in ${CODE_LIFETIME_WORDS}.</p>
  <p style="margin:0">If you did not ask for it, you can ignore this email and nothing will change.</p>
  <p style="margin-top:32px;font-size:12px;color:#71717a">Needd Connect, one provider, one bill, local support.<br/>Needd Technology Solutions (Pty) Ltd</p>
</div>`;
  return { text, html };
}

/** Hand the code to the channel it belongs to. Throws when nothing carried it. */
async function deliverOtp(target: OtpTarget, code: string): Promise<string> {
  if (target.channel === "email") {
    const { text, html } = otpEmailBody(code);
    const result = await sendEmail({
      to: target.identifier,
      subject: `${code} is your Needd Connect sign-in code`,
      text,
      html,
    });
    if (!result.ok) {
      throw new Error(`Could not send the code: ${result.detail}`);
    }
    return "email";
  }

  // WhatsApp first, SMS fallback (console driver in dev).
  if (whatsappEnabled()) {
    const wa = await sendWhatsAppTemplate({
      to: target.identifier,
      template: "otp_login",
      bodyParams: [code],
    });
    if (wa.ok) return "whatsapp";
  }
  const sms = getSmsAdapter();
  const result = await sms.send(
    target.identifier,
    `${code} is your Needd Connect verification code. It expires in ${CODE_LIFETIME_WORDS}.`
  );
  if (!result.ok) {
    throw new Error(`Could not send the code: ${result.detail}`);
  }
  return `sms:${sms.name}`;
}

export async function requestOtp(
  target: OtpTarget,
  ip: string | null
): Promise<OtpSendOutcome> {
  const normalized = normalizeOtpTarget(target);
  const oneHourAgo = new Date(Date.now() - HOUR_MS);

  const [identifierCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(otpCodes)
    .where(
      and(
        eq(otpCodes.identifier, normalized.identifier),
        eq(otpCodes.channel, normalized.channel),
        gt(otpCodes.createdAt, oneHourAgo)
      )
    );

  let ipCount: number | null = null;
  if (ip) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(otpCodes)
      .where(and(eq(otpCodes.ip, ip), gt(otpCodes.createdAt, oneHourAgo)));
    ipCount = row.n;
  }

  const limit = otpRateLimitVerdict({
    identifierInLastHour: identifierCount.n,
    ipInLastHour: ipCount,
  });
  if (limit.limited) {
    throw new OtpRateLimitError(
      limit.scope,
      normalized.channel,
      limit.scope === "identifier"
        ? await identifierRetryAfterMinutes(normalized)
        : null
    );
  }

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await db.insert(otpCodes).values({
    identifier: normalized.identifier,
    channel: normalized.channel,
    ip,
    codeHash: sha256(code),
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });

  const via = await deliverOtp(normalized, code);
  return {
    sent: true,
    channel: normalized.channel,
    via,
    identifier: normalized.identifier,
    expiresInSeconds: OTP_TTL_SECONDS,
    resendInSeconds: OTP_RESEND_COOLDOWN_SECONDS,
  };
}

/* ------------------------------------------------------------- verification */

/**
 * Check a code against the newest live one for that target.
 *
 * `consume: false` peeks: the verdict is the same, but a correct code stays
 * usable for the caller's next step (signing in through the Auth.js provider,
 * which verifies it again for real). Attempts count failures only, so a peek
 * followed by a real verification never costs a try.
 */
export async function verifyOtp(
  target: OtpTarget,
  code: string,
  options: { consume?: boolean } = {}
): Promise<OtpVerifyResult> {
  const consume = options.consume ?? true;
  const { identifier, channel } = normalizeOtpTarget(target);
  const normalized: OtpTarget = { identifier, channel };
  const now = new Date();

  const [live] = await db
    .select()
    .from(otpCodes)
    .where(
      and(
        eq(otpCodes.identifier, identifier),
        eq(otpCodes.channel, channel),
        isNull(otpCodes.consumedAt),
        gt(otpCodes.expiresAt, now)
      )
    )
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);

  // Belt and braces on the one rule that must never bend: whatever the query
  // returned, a row from the other channel is not an answer to this challenge.
  if (!live || !otpRowMatchesTarget(live, normalized)) {
    // Nothing live, so the newest record for the target explains why.
    const [latest] = await db
      .select({ consumedAt: otpCodes.consumedAt })
      .from(otpCodes)
      .where(
        and(eq(otpCodes.identifier, identifier), eq(otpCodes.channel, channel))
      )
      .orderBy(desc(otpCodes.createdAt))
      .limit(1);
    if (!latest) {
      return {
        ok: false,
        status: "none",
        identifier,
        channel,
        alreadyUsed: false,
      };
    }
    if (latest.consumedAt) {
      return {
        ok: false,
        status: "none",
        identifier,
        channel,
        alreadyUsed: true,
      };
    }
    return { ok: false, status: "expired", identifier, channel };
  }

  if (live.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
    return {
      ok: false,
      status: "locked",
      identifier,
      channel,
      attemptsRemaining: 0,
    };
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
      ? {
          ok: false,
          status: "mismatch",
          identifier,
          channel,
          attemptsRemaining,
        }
      : {
          ok: false,
          status: "locked",
          identifier,
          channel,
          attemptsRemaining: 0,
        };
  }

  if (!consume) return { ok: true, status: "ok", identifier, channel };

  // Single-use: whoever wins the update owns the session, the loser is told
  // the code is spent rather than both being waved through.
  const [claimed] = await db
    .update(otpCodes)
    .set({ consumedAt: now })
    .where(and(eq(otpCodes.id, live.id), isNull(otpCodes.consumedAt)))
    .returning({ id: otpCodes.id });
  if (!claimed) {
    return {
      ok: false,
      status: "none",
      identifier,
      channel,
      alreadyUsed: true,
    };
  }
  return { ok: true, status: "ok", identifier, channel };
}
