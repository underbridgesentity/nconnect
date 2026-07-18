/**
 * Dev utility: create a SIM-based (RICA-requiring) order end-to-end at the
 * domain level — customer, RICA docs in the compliance bucket, order — then
 * simulate the PayFast ITN so the M3 lifecycle can be exercised in the
 * admin UI. Mirrors exactly what the signup wizard actions do.
 *
 * Usage: pnpm tsx scripts/dev-create-sim-order.ts [phone]
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });
import Module from "node:module";
import path from "node:path";
const moduleAny = Module as unknown as {
  _resolveFilename: (request: string, ...args: unknown[]) => string;
};
const origResolve = moduleAny._resolveFilename;
const noop = path.join(__dirname, "noop.js");
moduleAny._resolveFilename = function (request: string, ...args: unknown[]) {
  if (request === "server-only") return noop;
  return origResolve.call(this, request, ...args);
};

async function main() {
  const phone = process.argv[2] ?? "+27840000003";
  const sharp = (await import("sharp")).default;
  const { findOrCreateCustomer, createOrder } = await import(
    "../lib/domain/orders"
  );
  const { uploadFile } = await import("../lib/storage");
  const { execSync } = await import("node:child_process");

  const { customerId } = await findOrCreateCustomer({
    phone,
    name: "Lerato Molefe",
    email: "lerato.molefe@example.com",
    popiaConsent: true,
  });
  console.log("customer:", customerId);

  const doc = async (label: string) =>
    sharp({
      create: {
        width: 1000,
        height: 700,
        channels: 3,
        background: { r: 240, g: 240, b: 240 },
      },
    })
      .composite([
        {
          input: Buffer.from(
            `<svg width="1000" height="700"><text x="40" y="80" font-size="40">${label}</text></svg>`
          ),
        },
      ])
      .webp()
      .toBuffer();

  const idDocPath = `rica/${customerId}/id-dev.webp`;
  const poaDocPath = `rica/${customerId}/poa-dev.webp`;
  await uploadFile("compliance", idDocPath, await doc("TEST ID DOCUMENT"), "image/webp");
  await uploadFile("compliance", poaDocPath, await doc("TEST PROOF OF ADDRESS"), "image/webp");

  const order = await createOrder({
    customerId,
    cart: {
      planSlugs: ["telkom-lte-starter"],
      hardware: [{ sku: "RTR-CD-LT500", qty: 1 }],
      bundleSlug: null,
    },
    address: {
      line1: "12 Acacia Avenue",
      suburb: "Rondebosch",
      city: "Cape Town",
      postalCode: "7700",
    },
    channel: "web",
    rica: {
      idNumber: "9001015800085",
      idDocPath,
      poaDocPath,
    },
  });
  console.log("order:", order.orderNumber, order.orderId, `R${order.totalCents / 100}`);

  execSync(`pnpm tsx scripts/simulate-itn.ts ${order.orderId}`, {
    stdio: "inherit",
  });
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
