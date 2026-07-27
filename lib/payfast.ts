import "server-only";
import { createHash } from "node:crypto";
import { appUrl } from "@/lib/config";

/**
 * PayFast integration (spec §3, §6.2): redirect checkout + ITN verification.
 * The ITN webhook is the only source of truth for payment status.
 * Sandbox first; PAYFAST_MODE=live switches hosts.
 */

const SANDBOX_HOST = "https://sandbox.payfast.co.za";
const LIVE_HOST = "https://www.payfast.co.za";

/** PayFast's published ITN source domains (verified via DNS at runtime). */
const VALID_ITN_HOSTS = [
  "www.payfast.co.za",
  "w1w.payfast.co.za",
  "w2w.payfast.co.za",
  "sandbox.payfast.co.za",
];

export function payfastHost(): string {
  return process.env.PAYFAST_MODE === "live" ? LIVE_HOST : SANDBOX_HOST;
}

function config() {
  const merchantId = process.env.PAYFAST_MERCHANT_ID;
  const merchantKey = process.env.PAYFAST_MERCHANT_KEY;
  const passphrase = process.env.PAYFAST_PASSPHRASE ?? "";
  if (!merchantId || !merchantKey) {
    throw new Error("PayFast credentials not configured");
  }
  return { merchantId, merchantKey, passphrase };
}

/**
 * PayFast signature: MD5 of the urlencoded name=value pairs in field order
 * (not alphabetical for the request payload), with passphrase appended.
 * Encoding must be byte-identical to PHP's urlencode(): everything except
 * [A-Za-z0-9-_.] percent-encoded with UPPERCASE hex, spaces as '+'.
 * (JS encodeURIComponent leaves !'()*~ raw, that breaks the signature.)
 */
function pfEncode(value: string): string {
  const bytes = Buffer.from(value.trim(), "utf8");
  let out = "";
  for (const byte of bytes) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-_.]/.test(ch)) {
      out += ch;
    } else if (ch === " ") {
      out += "+";
    } else {
      out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

export function signPayload(
  fields: [string, string][],
  passphrase: string
): string {
  const pairs = fields
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${k}=${pfEncode(v)}`);
  if (passphrase) pairs.push(`passphrase=${pfEncode(passphrase)}`);
  return createHash("md5").update(pairs.join("&")).digest("hex");
}

export interface CheckoutRequest {
  /** Our payment id, becomes m_payment_id, the idempotency key. */
  paymentId: string;
  amountCents: number;
  itemName: string;
  customerFirstName?: string;
  customerLastName?: string;
  customerEmail?: string;
  customerPhone?: string;
  /** Request card tokenisation for recurring billing (spec §6.2). */
  tokenize?: boolean;
}

/** Build the fields + action URL for the PayFast redirect form. */
export function buildCheckout(req: CheckoutRequest): {
  actionUrl: string;
  fields: Record<string, string>;
} {
  const { merchantId, merchantKey, passphrase } = config();
  const base = appUrl();

  const ordered: [string, string][] = [
    ["merchant_id", merchantId],
    ["merchant_key", merchantKey],
    ["return_url", `${base}/signup/success?ref=${req.paymentId}`],
    ["cancel_url", `${base}/signup/cancelled?ref=${req.paymentId}`],
    ["notify_url", `${base}/api/webhooks/payfast`],
  ];
  if (req.customerFirstName) ordered.push(["name_first", req.customerFirstName]);
  if (req.customerLastName) ordered.push(["name_last", req.customerLastName]);
  if (req.customerEmail) ordered.push(["email_address", req.customerEmail]);
  ordered.push(
    ["m_payment_id", req.paymentId],
    ["amount", (req.amountCents / 100).toFixed(2)],
    ["item_name", req.itemName.slice(0, 100)]
  );
  if (req.tokenize) ordered.push(["subscription_type", "2"]); // tokenisation

  const signature = signPayload(ordered, passphrase);
  const fields = Object.fromEntries(ordered);
  fields.signature = signature;
  return { actionUrl: `${payfastHost()}/eng/process`, fields };
}

/**
 * Verify an ITN post: signature over the received fields (in received order,
 * minus `signature`), amount match is the caller's job. Returns true only on
 * an exact signature match.
 */
export function verifyItnSignature(params: URLSearchParams): boolean {
  const { passphrase } = config();
  const received = params.get("signature") ?? "";
  const fields: [string, string][] = [];
  for (const [key, value] of params.entries()) {
    if (key === "signature") continue;
    fields.push([key, value]);
  }
  const expected = signPayload(fields, passphrase);
  return expected === received;
}

/** Resolve-and-match the caller IP against PayFast's published hosts. */
export async function verifyItnSourceIp(ip: string | null): Promise<boolean> {
  if (!ip) return false;
  if (process.env.PAYFAST_MODE !== "live") {
    // Sandbox + local testing: accept loopback too.
    if (ip === "127.0.0.1" || ip === "::1") return true;
  }
  const { resolve4 } = await import("node:dns/promises");
  const results = await Promise.allSettled(VALID_ITN_HOSTS.map((h) => resolve4(h)));
  const valid = new Set(
    results.flatMap((r) => (r.status === "fulfilled" ? r.value : []))
  );
  return valid.has(ip);
}

/** Server-to-server validation callback to PayFast (defence in depth). */
export async function confirmItnWithPayfast(rawBody: string): Promise<boolean> {
  const res = await fetch(`${payfastHost()}/eng/query/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: rawBody,
  });
  const text = (await res.text()).trim();
  return text === "VALID";
}

/** Charge a stored token server-side (recurring billing, spec §6.2). */
export async function chargeToken(req: {
  token: string;
  amountCents: number;
  itemName: string;
  paymentId: string;
}): Promise<{ ok: boolean; gatewayRef?: string; detail?: string }> {
  const { merchantId, passphrase } = config();
  const timestamp = new Date().toISOString().slice(0, 19) + "+02:00";
  const version = "v1";

  const bodyFields: [string, string][] = [
    ["amount", String(req.amountCents)],
    ["item_name", req.itemName.slice(0, 100)],
    ["m_payment_id", req.paymentId],
  ];
  // Signature for the tokenisation API: merchant-id, version, timestamp +
  // body fields, alphabetised.
  const sigFields: [string, string][] = [
    ...bodyFields,
    ["merchant-id", merchantId],
    ["timestamp", timestamp],
    ["version", version],
  ].sort(([a], [b]) => a.localeCompare(b)) as [string, string][];
  const signature = signPayload(sigFields, passphrase);

  const host =
    process.env.PAYFAST_MODE === "live"
      ? "https://api.payfast.co.za"
      : "https://api.payfast.co.za"; // sandbox uses ?testing=true
  const url = `${host}/subscriptions/${req.token}/adhoc${
    process.env.PAYFAST_MODE === "live" ? "" : "?testing=true"
  }`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "merchant-id": merchantId,
      version,
      timestamp,
      signature,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: bodyFields.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&"),
  });
  if (!res.ok) {
    return { ok: false, detail: `payfast ${res.status}: ${await res.text()}` };
  }
  const data = (await res.json().catch(() => null)) as {
    data?: { response?: unknown; message?: string };
  } | null;
  const pfPaymentId =
    data && typeof data.data?.response === "object" && data.data.response
      ? String(
          (data.data.response as Record<string, unknown>).pf_payment_id ?? ""
        )
      : String(data?.data?.response ?? "");
  return { ok: true, gatewayRef: pfPaymentId || undefined };
}
