/**
 * One-time-code copy for sign-in and signup.
 *
 * Email is the primary channel for customer accounts, so this is the wording
 * customers see on nearly every code. Kept pure (no DB, no server-only
 * imports) so the auth core, tests and the admin template preview can all
 * render the exact same copy.
 *
 * Three things the body must always say, per the security brief:
 *   1. the code itself,
 *   2. that it expires in five minutes,
 *   3. that nobody from Needd Connect will ever ask for it.
 */

export type OtpPurpose = "sign-in" | "sign-up";

export interface OtpEmailOptions {
  purpose?: OtpPurpose;
  /**
   * Kept as a parameter rather than imported from the auth core so this module
   * stays pure. Callers pass OTP_TTL_SECONDS / 60.
   */
  expiresInMinutes?: number;
}

export interface RenderedOtpEmail {
  subject: string;
  text: string;
  html: string;
}

const NEVER_ASK =
  "Nobody from Needd Connect will ever ask you for this code, not by email, not by phone, not on WhatsApp. If someone asks, it is not us.";

function minutesWord(minutes: number): string {
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

export function renderOtpEmail(
  code: string,
  options: OtpEmailOptions = {}
): RenderedOtpEmail {
  const purpose = options.purpose ?? "sign-in";
  const expiry = minutesWord(options.expiresInMinutes ?? 5);
  const isSignUp = purpose === "sign-up";
  const label = isSignUp ? "signup code" : "sign-in code";
  const opening = isSignUp
    ? "Here is the code to finish creating your Needd Connect account."
    : "Here is your Needd Connect sign-in code.";
  const ignore = isSignUp
    ? "If you did not start a signup, you can ignore this email and no account is created."
    : "If you did not ask for it, you can ignore this email and nothing will change.";

  const text = [
    `${code} is your Needd Connect ${label}.`,
    "",
    opening,
    `It expires in ${expiry}.`,
    "",
    NEVER_ASK,
    ignore,
    "",
    "Needd Connect, one provider, one bill, local support.",
  ].join("\n");

  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#18181b">
  <p style="margin:0 0 16px">${opening}</p>
  <p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:6px">${code}</p>
  <p style="margin:0 0 16px">It expires in ${expiry}.</p>
  <p style="margin:0 0 16px"><strong>${NEVER_ASK}</strong></p>
  <p style="margin:0">${ignore}</p>
  <p style="margin-top:32px;font-size:12px;color:#71717a">Needd Connect, one provider, one bill, local support.<br/>Needd Technology Solutions (Pty) Ltd</p>
</div>`;

  return {
    subject: `${code} is your Needd Connect ${label}`,
    text,
    html,
  };
}

/**
 * SMS and WhatsApp fallback copy for the phone channel. Short enough for one
 * SMS segment while still carrying the "we will never ask" warning.
 */
export function renderOtpSms(
  code: string,
  options: OtpEmailOptions = {}
): string {
  const expiry = minutesWord(options.expiresInMinutes ?? 5);
  return `${code} is your Needd Connect code. It expires in ${expiry}. We will never ask you for it.`;
}
