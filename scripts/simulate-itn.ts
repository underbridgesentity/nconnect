/**
 * Dev utility: simulate a PayFast ITN webhook for a pending order, since
 * PayFast's sandbox cannot reach localhost. Signs the payload exactly as
 * PayFast would (spec §6.2 flow, recorded in PROGRESS.md).
 *
 * Usage: pnpm tsx scripts/simulate-itn.ts <orderId> [amountRands]
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { createHash, randomBytes } from "node:crypto";

function pfEncode(value: string): string {
  return encodeURIComponent(value.trim()).replace(/%20/g, "+");
}

async function main() {
  const orderId = process.argv[2];
  if (!orderId) {
    console.error("Usage: pnpm tsx scripts/simulate-itn.ts <orderId> [amountRands]");
    process.exit(1);
  }

  // Read the order to get the exact amount unless overridden.
  const postgres = (await import("postgres")).default;
  const client = postgres(process.env.DATABASE_URL!, { prepare: false });
  const [order] = await client`
    select id, number, total_cents, status from orders where id = ${orderId}
  `;
  if (!order) {
    console.error("Order not found");
    process.exit(1);
  }
  const amount =
    process.argv[3] != null
      ? parseFloat(process.argv[3]).toFixed(2)
      : (order.total_cents / 100).toFixed(2);

  const fields: [string, string][] = [
    ["m_payment_id", orderId],
    ["pf_payment_id", `SIM-${randomBytes(6).toString("hex")}`],
    ["payment_status", "COMPLETE"],
    ["item_name", `Needd Connect order ${order.number}`],
    ["amount_gross", amount],
    ["amount_fee", "-2.50"],
    ["amount_net", (parseFloat(amount) - 2.5).toFixed(2)],
    ["merchant_id", process.env.PAYFAST_MERCHANT_ID ?? "10000100"],
    ["token", `TOK-${randomBytes(8).toString("hex")}`],
  ];
  const passphrase = process.env.PAYFAST_PASSPHRASE ?? "";
  const pairs = fields.map(([k, v]) => `${k}=${pfEncode(v)}`);
  if (passphrase) pairs.push(`passphrase=${pfEncode(passphrase)}`);
  const signature = createHash("md5").update(pairs.join("&")).digest("hex");
  fields.push(["signature", signature]);

  const body = fields
    .map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%20/g, "+")}`)
    .join("&");

  const res = await fetch("http://localhost:3000/api/webhooks/payfast", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "x-forwarded-for": "127.0.0.1",
    },
    body,
  });
  console.log(`ITN response: ${res.status} ${await res.text()}`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
