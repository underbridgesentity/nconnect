/**
 * Dev utility: generate a static HTML page with several PayFast sandbox
 * forms (increasing field sets) to isolate signature issues.
 * Usage: pnpm tsx scripts/payfast-sig-test.ts > /tmp/pf-test.html
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });
import { createHash } from "node:crypto";

const MERCHANT_ID = process.env.PAYFAST_MERCHANT_ID ?? "10000100";
const MERCHANT_KEY = process.env.PAYFAST_MERCHANT_KEY ?? "46f0cd694581a";
const PASSPHRASE = process.env.PAYFAST_PASSPHRASE ?? "";

function pfEncode(value: string): string {
  return encodeURIComponent(value.trim()).replace(/%20/g, "+");
}

function sign(fields: [string, string][], passphrase: string): string {
  const pairs = fields
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${k}=${pfEncode(v)}`);
  if (passphrase) pairs.push(`passphrase=${pfEncode(passphrase)}`);
  return createHash("md5").update(pairs.join("&")).digest("hex");
}

function form(title: string, fields: [string, string][]): string {
  const signature = sign(fields, PASSPHRASE);
  const inputs = [...fields, ["signature", signature] as [string, string]]
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${v}">`)
    .join("\n");
  return `<h3>${title}</h3>
<form action="https://sandbox.payfast.co.za/eng/process" method="post">
${inputs}
<button type="submit">Submit ${title}</button>
</form><hr>`;
}

const base: [string, string][] = [
  ["merchant_id", MERCHANT_ID],
  ["merchant_key", MERCHANT_KEY],
];

const html = `<!doctype html><meta charset="utf-8"><title>PF sig test</title>
${form("1: minimal", [...base, ["amount", "50.00"], ["item_name", "Test item"]])}
${form("2: with urls", [
  ...base,
  ["return_url", "http://localhost:3000/signup/success?ref=abc-123"],
  ["cancel_url", "http://localhost:3000/signup/cancelled?ref=abc-123"],
  ["notify_url", "http://localhost:3000/api/webhooks/payfast"],
  ["amount", "50.00"],
  ["item_name", "Test item"],
])}
${form("3: with customer", [
  ...base,
  ["return_url", "http://localhost:3000/signup/success?ref=abc-123"],
  ["cancel_url", "http://localhost:3000/signup/cancelled?ref=abc-123"],
  ["notify_url", "http://localhost:3000/api/webhooks/payfast"],
  ["name_first", "Sipho"],
  ["name_last", "Nkosi"],
  ["email_address", "sipho.nkosi@example.com"],
  ["m_payment_id", "0198a-test"],
  ["amount", "50.00"],
  ["item_name", "Needd Connect order NC-2026-00002"],
])}
${form("4: with subscription_type", [
  ...base,
  ["return_url", "http://localhost:3000/signup/success?ref=abc-123"],
  ["cancel_url", "http://localhost:3000/signup/cancelled?ref=abc-123"],
  ["notify_url", "http://localhost:3000/api/webhooks/payfast"],
  ["name_first", "Sipho"],
  ["name_last", "Nkosi"],
  ["email_address", "sipho.nkosi@example.com"],
  ["m_payment_id", "0198a-test2"],
  ["amount", "50.00"],
  ["item_name", "Needd Connect order NC-2026-00002"],
  ["subscription_type", "2"],
])}
`;
console.log(html);
