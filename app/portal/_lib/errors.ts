import "server-only";
import { AuthorizationError } from "@/lib/auth/authorize";

/**
 * Domain functions throw for operators, not for customers: "Already on that
 * plan", "Invalid transition: active -> cancelled", a Postgres constraint
 * string. None of that belongs in a toast on a customer's phone.
 *
 * Map the ones a customer can actually trigger to plain language, log the
 * rest, and never surface a raw message.
 */

const FRIENDLY: Array<[RegExp, string]> = [
  [
    /^Not authenticated$/,
    "Your session has expired. Sign in again and we'll pick up where you left off.",
  ],
  [
    /^No customer account$/,
    "We could not match this sign-in to a customer account. Message us in Help and we'll sort it out.",
  ],
  [
    /^Service not found$/,
    "We could not find that service on your account. Go back to My services and try again.",
  ],
  [
    /^Plan changes need an active service$/,
    "This service is not active right now, so the plan cannot be changed. Message us in Help and we'll help.",
  ],
  [
    /^That plan is not available$/,
    "That plan is no longer available. Go back and pick another one.",
  ],
  [
    /^Already on that plan$/,
    "You are already on that plan, so nothing was changed.",
  ],
  [
    /^Plan changes stay within the same category/,
    "You can only move between plans of the same type. For a different product, message us in Help.",
  ],
  [
    /^Invalid transition/,
    "That change no longer applies to this service, it may have been updated already. Reload the page to see where it stands.",
  ],
  [/^Photo too large/, "That photo is too large, the limit is 10MB."],
  [
    /^No pending plan change$/,
    "There is no scheduled plan change on this service any more.",
  ],
];

export const GENERIC_ERROR =
  "Something went wrong on our side and nothing was changed. Try again, and if it keeps happening message us in Help.";

/** Customer-safe message for any thrown error. Logs the original server-side. */
export function customerFacingError(err: unknown): string {
  if (err instanceof AuthorizationError) {
    return "You do not have permission to do that from here. Message us in Help and we'll take care of it.";
  }
  const message = err instanceof Error ? err.message : String(err);
  for (const [pattern, copy] of FRIENDLY) {
    if (pattern.test(message)) return copy;
  }
  console.error("portal action error:", err);
  return GENERIC_ERROR;
}
