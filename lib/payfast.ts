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

/**
 * MD5 over `key=value` pairs joined with `&`, with the passphrase appended.
 *
 * The two directions differ on blank fields, and getting this wrong breaks
 * payments in a way that only shows up against the real gateway:
 *
 * - OUTGOING (the redirect form): PayFast's reference builder skips empty
 *   values, and so must we, or the hosted page rejects the signature.
 * - INCOMING (ITN verification): PayFast's merchant-side reference iterates
 *   every posted field and includes blanks as `key=`. Real ITNs routinely post
 *   empty optionals (name_last, custom_str1 to 5, token), so filtering them out
 *   computes a different digest and every genuine payment fails to verify.
 */
export function signPayload(
  fields: [string, string][],
  passphrase: string,
  opts: { skipEmpty?: boolean } = {}
): string {
  const { skipEmpty = true } = opts;
  const pairs = (skipEmpty ? fields.filter(([, v]) => v !== "") : fields).map(
    ([k, v]) => `${k}=${pfEncode(v)}`
  );
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
  /**
   * Where PayFast sends the customer after a successful payment, site-relative
   * and including any query string the destination needs, for example
   * `/pay/{invoiceId}/thank-you`. Defaults to the signup success page, which is
   * only ever correct for a checkout that created an order: an invoice paid
   * from the portal or a pay link has no signup to look up.
   */
  returnPath?: string;
  /** Same, for the customer who abandons the PayFast page. */
  cancelPath?: string;
}

/**
 * Return and cancel URLs are ours, never the customer's: a value that is not
 * site-relative would hand PayFast an off-site redirect. Callers pass literal
 * paths, so a bad one is a programming error and says so straight away.
 */
function checkoutUrl(base: string, path: string | undefined, fallback: string): string {
  if (path === undefined) return `${base}${fallback}`;
  const trimmed = path.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    throw new Error(
      `PayFast return and cancel paths must be site-relative and start with "/", got "${path}"`
    );
  }
  return `${base}${trimmed}`;
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
    [
      "return_url",
      checkoutUrl(base, req.returnPath, `/signup/success?ref=${req.paymentId}`),
    ],
    [
      "cancel_url",
      checkoutUrl(base, req.cancelPath, `/signup/cancelled?ref=${req.paymentId}`),
    ],
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
 * Verify an ITN post: signature over the received fields in received order,
 * minus `signature`, keeping blank values. Amount match is the caller's job.
 * Returns true only on an exact signature match.
 */
export function verifyItnSignature(params: URLSearchParams): boolean {
  const { passphrase } = config();
  const received = params.get("signature") ?? "";
  const fields: [string, string][] = [];
  for (const [key, value] of params.entries()) {
    if (key === "signature") continue;
    fields.push([key, value]);
  }
  // skipEmpty: false, see signPayload. PayFast signs every field it posts.
  const expected = signPayload(fields, passphrase, { skipEmpty: false });
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

/**
 * Namespace for a payment reference we minted ourselves because PayFast
 * confirmed a charge without naming one.
 *
 * `payments.gateway_ref` carries a unique index and is the only idempotency
 * key the settlement path has, so every banked charge needs a reference that
 * belongs to that charge and no other. The `m_payment_id` sent with the
 * request is exactly that: it encodes the invoice and the attempt, PayFast
 * stores it against the transaction, and it is the value an operator searches
 * on in the PayFast dashboard.
 *
 * The prefix is what stops anyone reading it as PayFast's own reference. Real
 * `pf_payment_id` values are plain digits, so a reference starting with
 * "payfast-adhoc:" is unmistakably ours and says, in the ledger, that the
 * gateway confirmed the debit without identifying the transaction.
 */
export const DERIVED_GATEWAY_REF_PREFIX = "payfast-adhoc:";

/** The reference to bank a confirmed-but-unidentified charge under. */
export function derivedGatewayRef(paymentId: string): string {
  const id = paymentId.trim();
  if (!id) {
    throw new Error("A payment id is required to derive a gateway reference");
  }
  return id.startsWith(DERIVED_GATEWAY_REF_PREFIX)
    ? id
    : `${DERIVED_GATEWAY_REF_PREFIX}${id}`;
}

/** Did we mint this reference ourselves, rather than read it from PayFast? */
export function isDerivedGatewayRef(ref: string): boolean {
  return ref.trim().startsWith(DERIVED_GATEWAY_REF_PREFIX);
}

/** The m_payment_id inside a reference we derived, for reconciliation. */
export function merchantRefFromDerived(ref: string): string | null {
  const trimmed = ref.trim();
  return trimmed.startsWith(DERIVED_GATEWAY_REF_PREFIX)
    ? trimmed.slice(DERIVED_GATEWAY_REF_PREFIX.length)
    : null;
}

/**
 * What one ad-hoc charge reply means.
 *
 * `charged` and `declined` are statements about the customer's money.
 * `unknown` is the honest third answer for a reply we cannot read at all: the
 * caller must treat it as "the card may have been debited", never as a decline
 * the timeline is free to retry.
 */
export type AdhocChargeReading =
  | { kind: "charged"; gatewayRef: string; derived: boolean }
  | { kind: "declined"; detail: string }
  | { kind: "unknown"; detail: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Non-empty string or finite number as text; anything else is nothing. */
function readable(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** PayFast's transaction id out of an object response, whatever it is called. */
function transactionIdFrom(response: Record<string, unknown>): string | null {
  for (const key of ["pf_payment_id", "pfPaymentId", "payment_id", "id"]) {
    const value = readable(response[key]);
    if (value) return value;
  }
  return null;
}

/**
 * Read the ad-hoc endpoint's body and say what happened to the money.
 *
 * The documented success body is `{"code":200,"status":"success","data":
 * {"response":true,"message":"..."}}`: the API confirms the debit and names no
 * transaction. Reading that field as a string is what banked every recurring
 * charge under the literal reference "true", and because the gateway reference
 * is the sole idempotency key, the first charge banked and every later one was
 * swallowed as a duplicate.
 *
 * So each documented shape is handled on its own terms:
 *
 * - `response` an object: PayFast named the transaction, use its id.
 * - `response` a number or a numeric string: some accounts get the transaction
 *   id back in place of the boolean, so that is a real reference too.
 * - `response` true, or absent under a success envelope: the debit happened
 *   and has no reference of its own, so it is banked under one derived from
 *   the `m_payment_id`, unique to this charge and marked as ours.
 * - `response` false, or a failed envelope: a decline, no money moved.
 * - anything else: unknown, which is never treated as a decline.
 *
 * The envelope decides, not the HTTP status: PayFast answers 200 OK with a
 * failed envelope as readily as it answers 400.
 */
export function readAdhocChargeResponse(
  body: unknown,
  paymentId: string
): AdhocChargeReading {
  if (!isRecord(body)) {
    return {
      kind: "unknown",
      detail: "the ad-hoc endpoint answered with a body we could not read",
    };
  }

  const data = isRecord(body.data) ? body.data : null;
  const message = readable(data?.message) ?? readable(body.message);
  const code = typeof body.code === "number" ? body.code : null;
  const status = readable(body.status)?.toLowerCase() ?? null;
  const response = data ? data.response : body.response;
  const succeeded =
    status === "success" || (code !== null && code >= 200 && code < 300);
  const failed =
    status === "failed" ||
    status === "error" ||
    (code !== null && (code < 200 || code >= 300));

  if (failed || response === false || readable(response)?.toLowerCase() === "false") {
    return {
      kind: "declined",
      detail:
        message ?? `charge declined${code === null ? "" : ` (code ${code})`}`,
    };
  }

  if (isRecord(response)) {
    const gatewayRef = transactionIdFrom(response);
    return gatewayRef
      ? { kind: "charged", gatewayRef, derived: false }
      : { kind: "charged", gatewayRef: derivedGatewayRef(paymentId), derived: true };
  }

  if (response === true) {
    return {
      kind: "charged",
      gatewayRef: derivedGatewayRef(paymentId),
      derived: true,
    };
  }

  const scalar = readable(response);
  if (scalar) {
    if (scalar.toLowerCase() === "true") {
      return {
        kind: "charged",
        gatewayRef: derivedGatewayRef(paymentId),
        derived: true,
      };
    }
    return { kind: "charged", gatewayRef: scalar, derived: false };
  }

  if (succeeded) {
    // A success envelope with no response field: the charge went through and
    // the reply says nothing else about it.
    return {
      kind: "charged",
      gatewayRef: derivedGatewayRef(paymentId),
      derived: true,
    };
  }

  return {
    kind: "unknown",
    detail:
      message ??
      "the ad-hoc endpoint did not say whether the card was charged",
  };
}

/**
 * Charge a stored token server-side (recurring billing, spec §6.2).
 *
 * `paymentId` becomes the `m_payment_id` and must be unique to this attempt:
 * it is what a confirmed-but-unidentified charge is banked under, and banking
 * two charges under one reference loses one of them.
 *
 * Throws when the outcome is genuinely unknown. The caller reads a thrown
 * error as "the card may have been debited", which banks nothing and retries
 * nothing, and that is the only safe reading of an unreadable reply.
 */
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
  /*
   * The tokenisation API signs differently from the redirect form. The redirect
   * takes the fields in payload order with the passphrase appended last; the
   * API takes the header fields plus the body fields PLUS the passphrase, all
   * sorted alphabetically together. `passphrase` sorts between `merchant-id`
   * and `timestamp`, so appending it last (which signPayload does by default)
   * produces a digest PayFast rejects, and every recurring card charge fails.
   * Hence signing with an empty passphrase here and carrying it as an ordinary
   * sorted field.
   */
  const sigFields: [string, string][] = [
    ...bodyFields,
    ["merchant-id", merchantId],
    ["timestamp", timestamp],
    ["version", version],
    ...(passphrase
      ? ([["passphrase", passphrase]] as [string, string][])
      : []),
  ].sort(([a], [b]) => a.localeCompare(b)) as [string, string][];
  const signature = signPayload(sigFields, "");

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
  const rawBody = (await res.text().catch(() => "")).slice(0, 2000);

  if (!res.ok) {
    // A 4xx is PayFast telling us it refused the request, so no money moved.
    // A 5xx, a timeout or a rate-limit is the gateway failing to answer, which
    // says nothing about whether the card was debited, so it is not a decline.
    if (res.status >= 500 || res.status === 408 || res.status === 429) {
      throw new Error(
        `payfast ad-hoc charge outcome unknown, HTTP ${res.status}: ${rawBody}`
      );
    }
    return { ok: false, detail: `payfast ${res.status}: ${rawBody}` };
  }

  let body: unknown = null;
  try {
    body = JSON.parse(rawBody);
  } catch {
    body = null;
  }

  const reading = readAdhocChargeResponse(body, req.paymentId);
  if (reading.kind === "unknown") {
    throw new Error(`payfast ad-hoc charge outcome unknown: ${reading.detail}`);
  }
  if (reading.kind === "declined") {
    return { ok: false, detail: reading.detail };
  }
  return {
    ok: true,
    gatewayRef: reading.gatewayRef,
    detail: reading.derived
      ? "PayFast confirmed the charge without naming a transaction"
      : undefined,
  };
}
