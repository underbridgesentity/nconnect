"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { AuthError } from "next-auth";
import {
  requestOtp,
  verifyOtp,
  otpThrottleState,
  otpFailureMessage,
  normalizeEmail,
  isValidEmail,
  OtpRateLimitError,
  EmailFormatError,
  OTP_TTL_SECONDS,
  type OtpTarget,
} from "@/lib/auth/otp";
import { findCustomerAccountByEmail } from "@/lib/auth/customer-account";
import { safeCallbackUrl } from "@/lib/auth/callback-url";
import { signIn } from "@/lib/auth";

/**
 * Customer sign-in, in two steps: send a code, check a code.
 *
 * Both actions answer with everything the screen needs to be honest about what
 * just happened: which address the code went to, how long it lasts, when
 * another may be asked for, and, when a code is refused, exactly why.
 *
 * The credential is the email address. A phone number is still on every
 * account because RICA requires one, but it is no longer how anyone gets in.
 */

const DEFAULT_DESTINATION = "/portal";

const BAD_EMAIL =
  "That does not look like an email address. Try thandi@example.com.";

const emailSchema = z
  .string()
  .trim()
  .refine(isValidEmail, BAD_EMAIL)
  .transform(normalizeEmail);

const codeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Codes are 6 digits. Check the email and try again.");

export type SendCodeResult = {
  ok: boolean;
  /** Why no code went out, ready to show as-is. */
  error?: string;
  /** Something true and reassuring, when there is something to say. */
  notice?: string;
  /** Normalised, the address the live code actually belongs to. */
  email?: string;
  /** How the code was carried, "email" today. Names the right inbox. */
  via?: string;
  /** Seconds until the live code dies, and until another may be requested. */
  expiresInSeconds?: number;
  resendInSeconds?: number;
};

export type VerifyCodeResult = { ok: true } | { ok: false; error: string };

async function clientIp(): Promise<string | null> {
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

/** The address as an OTP target, or null when it is not one we can send to. */
function targetFor(rawEmail: string): OtpTarget | null {
  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) return null;
  return { identifier: parsed.data, channel: "email" };
}

/**
 * Send a code, or explain why not. `resend` only changes the wording: the
 * limits are the same either way and are enforced here, not in the browser,
 * so a double tap cannot burn one of the five codes an hour this address gets.
 */
export async function sendLoginCodeAction(input: {
  email: string;
  resend?: boolean;
}): Promise<SendCodeResult> {
  const target = targetFor(input.email);
  if (!target) return { ok: false, error: BAD_EMAIL };

  const throttle = await otpThrottleState(target);
  if (throttle.resendInSeconds > 0) {
    const ago = throttle.liveCodeSentSecondsAgo ?? 0;
    if (input.resend) {
      return {
        ok: false,
        error: `Give that code a moment to arrive. You can ask for a new one in ${throttle.resendInSeconds} seconds.`,
        resendInSeconds: throttle.resendInSeconds,
      };
    }
    // A code for this address went out seconds ago and is still good: send them
    // to the code screen rather than spending another one.
    return {
      ok: true,
      email: target.identifier,
      via: "email",
      notice:
        "We emailed a code to that address moments ago, it should be arriving now.",
      expiresInSeconds: Math.max(0, OTP_TTL_SECONDS - ago),
      resendInSeconds: throttle.resendInSeconds,
    };
  }

  try {
    const sent = await requestOtp(target, await clientIp());
    return {
      ok: true,
      email: sent.identifier,
      via: sent.via,
      notice: input.resend ? "New code sent to that address." : undefined,
      expiresInSeconds: sent.expiresInSeconds,
      resendInSeconds: sent.resendInSeconds,
    };
  } catch (err) {
    if (err instanceof OtpRateLimitError) {
      return { ok: false, error: err.message };
    }
    if (err instanceof EmailFormatError) {
      return { ok: false, error: BAD_EMAIL };
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
  email: string;
  code: string;
  callbackUrl?: string;
}): Promise<VerifyCodeResult> {
  const target = targetFor(input.email);
  if (!target) {
    return { ok: false, error: "Start by giving us your email address." };
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
  const verdict = await verifyOtp(target, parsedCode.data, { consume: false });
  if (!verdict.ok) {
    // One wording for a refused code, shared with signup and quote acceptance,
    // so the same code never gets two different diagnoses on two screens.
    return { ok: false, error: otpFailureMessage(verdict) };
  }

  // The code is good. Whether there is an account behind the address is a
  // different question, and asking it before the provider spends the code
  // means a customer who mistyped their address keeps their live code.
  const account = await findCustomerAccountByEmail(verdict.identifier);
  if (account.status === "unknown") {
    return {
      ok: false,
      error: `That code was right, but ${verdict.identifier} does not have a Needd Connect account yet. Order a service and we will create one for you.`,
    };
  }
  if (account.status === "disabled") {
    return {
      ok: false,
      error: "That account is closed. Get in touch and we will sort it out with you.",
    };
  }
  if (account.status === "staff") {
    return {
      ok: false,
      error:
        "That address belongs to a staff account. Use the staff sign-in page with your email and password.",
    };
  }

  try {
    await signIn("customer-email-otp", {
      email: verdict.identifier,
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
