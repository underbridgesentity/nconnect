"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { AuthError } from "next-auth";
import {
  requestOtp,
  verifyOtp,
  otpThrottleState,
  normalizePhone,
  formatPhoneForDisplay,
  OtpRateLimitError,
  PhoneFormatError,
  OTP_TTL_SECONDS,
} from "@/lib/auth/otp";
import { findCustomerAccount } from "@/lib/auth/customer-account";
import { safeCallbackUrl } from "@/lib/auth/callback-url";
import { signIn } from "@/lib/auth";

/**
 * Customer sign-in, in two steps: send a code, check a code.
 *
 * Both actions answer with everything the screen needs to be honest about what
 * just happened: which number the code went to, how long it lasts, when another
 * may be asked for, and, when a code is refused, exactly why.
 */

const DEFAULT_DESTINATION = "/portal";

const BAD_NUMBER =
  "That does not look like a South African cellphone number. Try 082 123 4567.";

const phoneSchema = z.string().trim().min(9, BAD_NUMBER).max(20, BAD_NUMBER);

const codeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Codes are 6 digits. Check the message and try again.");

export type SendCodeResult = {
  ok: boolean;
  /** Why no code went out, ready to show as-is. */
  error?: string;
  /** Something true and reassuring, when there is something to say. */
  notice?: string;
  /** E.164, the number the live code actually belongs to. */
  phone?: string;
  /** The same number as its owner would write it: 082 123 4567. */
  phoneDisplay?: string;
  /** "whatsapp" or "sms:<adapter>", so the screen names the right inbox. */
  channel?: string;
  /** Seconds until the live code dies, and until another may be requested. */
  expiresInSeconds?: number;
  resendInSeconds?: number;
};

export type VerifyCodeResult = { ok: true } | { ok: false; error: string };

async function clientIp(): Promise<string | null> {
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

/**
 * Send a code, or explain why not. `resend` only changes the wording: the
 * limits are the same either way and are enforced here, not in the browser,
 * so a double tap cannot burn one of the five codes an hour this number gets.
 */
export async function sendLoginCodeAction(input: {
  phone: string;
  resend?: boolean;
}): Promise<SendCodeResult> {
  const parsed = phoneSchema.safeParse(input.phone);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]!.message };
  }

  let phone: string;
  try {
    phone = normalizePhone(parsed.data);
  } catch (err) {
    if (!(err instanceof PhoneFormatError)) throw err;
    return { ok: false, error: BAD_NUMBER };
  }

  const throttle = await otpThrottleState(phone);
  if (throttle.resendInSeconds > 0) {
    const ago = throttle.liveCodeSentSecondsAgo ?? 0;
    if (input.resend) {
      return {
        ok: false,
        error: `Give that code a moment to arrive. You can ask for a new one in ${throttle.resendInSeconds} seconds.`,
        resendInSeconds: throttle.resendInSeconds,
      };
    }
    // A code for this number went out seconds ago and is still good: send them
    // to the code screen rather than spending another one.
    return {
      ok: true,
      phone,
      phoneDisplay: formatPhoneForDisplay(phone),
      notice: "We sent a code to that number moments ago, it should be arriving now.",
      expiresInSeconds: Math.max(0, OTP_TTL_SECONDS - ago),
      resendInSeconds: throttle.resendInSeconds,
    };
  }

  try {
    const sent = await requestOtp(phone, await clientIp());
    return {
      ok: true,
      phone: sent.phone,
      phoneDisplay: formatPhoneForDisplay(sent.phone),
      channel: sent.channel,
      notice: input.resend
        ? sent.channel === "whatsapp"
          ? "New code sent on WhatsApp."
          : "New code sent by SMS."
        : undefined,
      expiresInSeconds: sent.expiresInSeconds,
      resendInSeconds: sent.resendInSeconds,
    };
  } catch (err) {
    if (err instanceof OtpRateLimitError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "We could not send the code just now. Please try again.",
    };
  }
}

/** Check a code and start the session. Success redirects, so it never returns. */
export async function verifyLoginCodeAction(input: {
  phone: string;
  code: string;
  callbackUrl?: string;
}): Promise<VerifyCodeResult> {
  let phone: string;
  try {
    phone = normalizePhone(phoneSchema.parse(input.phone));
  } catch {
    return { ok: false, error: "Start by giving us your cellphone number." };
  }
  const parsedCode = codeSchema.safeParse(input.code);
  if (!parsedCode.success) {
    return { ok: false, error: parsedCode.error.issues[0]!.message };
  }

  // Untrusted: it has been through the browser. Same-origin relative paths
  // only, and never back onto a sign-in route.
  const destination = safeCallbackUrl(input.callbackUrl) ?? DEFAULT_DESTINATION;

  // Peek: the verdict without spending the code, because the Auth.js provider
  // verifies it again for real a few lines below. Failed tries still count.
  const verdict = await verifyOtp(phone, parsedCode.data, { consume: false });
  if (!verdict.ok) {
    switch (verdict.status) {
      case "mismatch":
        return {
          ok: false,
          error: `That code is not right. ${verdict.attemptsRemaining} ${
            verdict.attemptsRemaining === 1 ? "try" : "tries"
          } left before you need a new one.`,
        };
      case "locked":
        return {
          ok: false,
          error:
            "That was the last try on that code. Send a new one and you can start again.",
        };
      case "expired":
        return {
          ok: false,
          error: "That code has expired, they last 5 minutes. Send a new one below.",
        };
      case "none":
        return {
          ok: false,
          error: verdict.alreadyUsed
            ? "That code has already been used. Send a new one below."
            : "We have no code waiting for that number. Send a new one below.",
        };
    }
  }

  // The code is good. Whether there is an account behind the number is a
  // different question, and asking it before the provider spends the code
  // means a customer who mistyped their number keeps their live code.
  const account = await findCustomerAccount(verdict.phone);
  if (account.status === "unknown") {
    return {
      ok: false,
      error: `That code was right, but ${formatPhoneForDisplay(verdict.phone)} does not have a Needd Connect account yet. Order a service and we will create one for you.`,
    };
  }
  if (account.status === "disabled") {
    return {
      ok: false,
      error:
        "That account is closed. Call or WhatsApp us and we will sort it out with you.",
    };
  }
  if (account.status === "staff") {
    return {
      ok: false,
      error:
        "That number belongs to a staff account. Use the staff sign-in page with your email and password.",
    };
  }

  try {
    await signIn("customer-otp", {
      phone: verdict.phone,
      code: parsedCode.data,
      redirectTo: destination,
    });
    return { ok: true };
  } catch (err) {
    if (!(err instanceof AuthError)) throw err; // NEXT_REDIRECT on success
    return {
      ok: false,
      error:
        "We could not sign you in just now. Please try again, or contact us if it keeps happening.",
    };
  }
}
