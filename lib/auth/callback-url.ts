import "server-only";
import { appUrl } from "@/lib/config";

/**
 * Where to send someone once they have signed in.
 *
 * A customer who taps a "pay your invoice" link while signed out is bounced to
 * /login by proxy.ts, which records where they were going. Dropping that on the
 * floor and landing everyone on /portal makes them hunt for the thing they had
 * already found. So we carry it through the OTP flow and honour it.
 *
 * The value survives a round trip through the browser, so it is untrusted input
 * and gets validated again on the way out: same-origin only, reduced to a path,
 * and never back onto an auth route (that would bounce a freshly signed-in
 * customer straight back to the sign-in screen).
 */

const MAX_LENGTH = 1024;

/** Routes that would loop, or that mean nothing once you are signed in. */
const BLOCKED = [
  /^\/login(?:[/?#]|$)/,
  /^\/staff-login(?:[/?#]|$)/,
  /^\/setup(?:[/?#]|$)/,
  /^\/api\//,
];

export function safeCallbackUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > MAX_LENGTH) return null;
  // Control characters (a newline above all) have no place in a redirect.
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;

  let path: string;
  if (value.startsWith("/")) {
    // "//evil.example" and "/\evil.example" are other origins, not paths.
    if (value.startsWith("//") || value.startsWith("/\\")) return null;
    path = value;
  } else {
    let target: URL;
    let self: URL;
    try {
      target = new URL(value);
      self = new URL(appUrl());
    } catch {
      return null;
    }
    if (target.origin !== self.origin) return null;
    path = `${target.pathname}${target.search}${target.hash}`;
  }

  // Resolve "." and ".." segments so the result is the path it looks like.
  let resolved: URL;
  try {
    resolved = new URL(path, "https://needd.invalid");
  } catch {
    return null;
  }
  const out = `${resolved.pathname}${resolved.search}${resolved.hash}`;
  if (!out.startsWith("/") || out.startsWith("//")) return null;
  if (BLOCKED.some((pattern) => pattern.test(out))) return null;
  return out;
}

/**
 * The destination carried on a sign-in URL. proxy.ts writes `next`; Auth.js
 * writes `callbackUrl` when it sends someone to the sign-in page itself.
 */
export function callbackUrlFromParams(
  params: Record<string, string | string[] | undefined>
): string | null {
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  return (
    safeCallbackUrl(first(params.next)) ??
    safeCallbackUrl(first(params.callbackUrl))
  );
}
