import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import postgres from "postgres";
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

/**
 * M8 happy path (spec §15): signup -> paid order (simulated ITN, PayFast
 * sandbox can't reach localhost) -> admin activates through the Today
 * queue -> billing engine issues the anniversary invoice -> manual EFT
 * settles it. Mobile viewport throughout (390px).
 *
 * Requires the dev database (DATABASE_URL) and dev seed. The staff login
 * comes from E2E_ADMIN_PASSWORD (printed by `pnpm seed:dev`).
 */

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 2 });
const phone = `07${Date.now().toString().slice(-8)}`;
/*
 * The sign-in credential, on Resend's test domain.
 *
 * Accounts are created with an emailed code, so this suite makes the app send
 * a real message. resend.dev accepts and reports delivered without touching a
 * human inbox, which keeps the real send path under test instead of stubbed.
 * example.com would fail the run outright: Resend refuses it by design.
 *
 * Subaddressed with a timestamp so reruns never collide on the
 * case-insensitive unique index on users.email (verified: Resend accepts the
 * plus form).
 */
const email = `delivered+e2e${Date.now()}@resend.dev`;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;

test.describe.configure({ mode: "serial" });

let orderId: string;
let serviceId: string;

test("stranger signs up for VoIP on a phone and reaches payment", async ({
  page,
}) => {
  await page.goto("/signup?plan=voip-basic");
  await expect(page.getByText("Business VoIP Basic selected")).toBeVisible();
  await page.getByRole("button", { name: "Continue to address" }).first().click();

  await page.getByLabel("Street address").fill("221B Long Street");
  await page.getByLabel("City").fill("Cape Town");
  await page.getByLabel("Postal code").fill("8001");
  await page.getByRole("button", { name: "Check coverage and continue" }).click();

  // Accounts are created with an email address and verified by an emailed
  // code. The phone number is still required, because RICA needs a reachable
  // number for any SIM-based service, it is simply no longer the credential.
  await page.getByLabel("Full name").fill("E2E Happy Path");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Cellphone number").fill(phone);
  await page.getByRole("button", { name: "Email me a code" }).click();

  // OTPs are hashed at rest, so the test cannot read the code that was sent.
  // Once the code screen is up (proving the app wrote its own row), insert a
  // known one: verifyOtp takes the newest unconsumed row for that identifier.
  // The channel matters now, an email challenge is only satisfied by an email
  // code, so this row has to say 'email'.
  await expect(page.getByLabel("6-digit code")).toBeVisible({ timeout: 30_000 });
  const { createHash } = await import("node:crypto");
  const code = "424242";
  await sql`insert into otp_codes (id, identifier, channel, code_hash, expires_at)
    values (gen_random_uuid(), ${email}, 'email',
            ${createHash("sha256").update(code).digest("hex")}, now() + interval '5 minutes')`;

  await page.getByLabel("6-digit code").fill(code);
  await page.locator("[role=checkbox]").first().click(); // POPIA
  await page.getByRole("button", { name: "Create my account" }).click();

  try {
    await expect(page.getByText("Review your order")).toBeVisible({ timeout: 15_000 });
  } catch (err) {
    console.log("PAGE STATE:", (await page.locator("body").innerText()).slice(0, 600));
    throw err;
  }
  // formatCents renders en-ZA, so the amount carries a non-breaking space
  // ("R 764"). Playwright normalises that to a plain space in the
  // accessible name, hence the optional whitespace: matching "R764" would only
  // ever pass against a hardcoded, unlocalised label.
  await page.getByRole("button", { name: /Pay R\s?764 securely/ }).click();
  // The PayFast form is prepared; the order now exists as pending_payment.
  await expect(page.getByText(/Taking you to PayFast/)).toBeVisible({
    timeout: 20_000,
  });

  const [order] = await sql`
    select o.id from orders o
    join customers c on o.customer_id = c.id
    where c.email = ${email}
    order by o.created_at desc limit 1`;
  expect(order).toBeTruthy();
  orderId = order.id;
});

test("payment lands via ITN and provisioning starts", async () => {
  execSync(`pnpm tsx scripts/simulate-itn.ts ${orderId}`, { stdio: "pipe" });
  const [order] = await sql`select status from orders where id = ${orderId}`;
  expect(order.status).toBe("paid");
  const [service] = await sql`
    select id, status from services where origin_order_id = ${orderId}`;
  expect(service.status).toBe("provisioning");
  serviceId = service.id;
});

test("admin completes the activation task from Today", async ({ page }) => {
  test.skip(!adminPassword, "E2E_ADMIN_PASSWORD not set");
  // Close stale tasks from previous E2E runs so the Today queue shows only
  // this run's activation for "E2E Happy Path".
  await sql`update provisioning_tasks set status = 'done'
    where status <> 'done' and service_id in (
      select s.id from services s
      join customers c on s.customer_id = c.id
      where c.first_name = 'E2E' and s.id <> ${serviceId}
    )`;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/staff-login");
  await page.getByLabel("Email").fill("admin@needdconnect.co.za");
  await page.getByLabel("Password").fill(adminPassword!);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Sign-in hops through /after-login before the role router lands on /admin,
  // and Today itself fans out over a dozen queries behind a loading skeleton.
  // The default 5s assertion timeout is tight enough that a cold dev compile
  // fails it, so this waits as long as the other slow steps in this file.
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible({
    timeout: 30_000,
  });

  await page
    .getByRole("button", { name: /E2E Happy Path/ })
    .first()
    .click();
  // Tick every checklist item.
  const boxes = page.locator("[role=checkbox]");
  const count = await boxes.count();
  for (let index = 0; index < count; index++) {
    await boxes.nth(index).click();
    await page.waitForTimeout(400);
  }
  await page.getByPlaceholder("Provider external ref").fill("E2E-REF-001");
  await page.getByRole("button", { name: "Complete task" }).click();
  await expect(page.getByText("Task completed")).toBeVisible();

  const [service] = await sql`
    select status, next_invoice_date from services where id = ${serviceId}`;
  expect(service.status).toBe("active");
  expect(service.next_invoice_date).toBeTruthy();
});

test("billing engine issues the anniversary invoice and EFT settles it", async () => {
  const [service] = await sql`
    select next_invoice_date from services where id = ${serviceId}`;
  const anchorDate = new Date(service.next_invoice_date).toISOString().slice(0, 10);
  // Time-travel the engine to the anchor date.
  const script = `
    import { config } from "dotenv"; config({ path: [".env.local", ".env"] });
    import Module from "node:module"; import path from "node:path";
    const m = Module as any; const orig = m._resolveFilename;
    m._resolveFilename = function (r: string, ...a: unknown[]) {
      return r === "server-only" ? path.join(process.cwd(), "scripts/noop.js") : orig.call(this, r, ...a);
    };
    (async () => {
      const { runInvoiceGeneration } = await import("../lib/domain/billing-engine");
      await runInvoiceGeneration(${JSON.stringify(anchorDate)});
      process.exit(0);
    })();
  `;
  const { writeFileSync, rmSync } = await import("node:fs");
  writeFileSync("scripts/__e2e-billing.ts", script);
  try {
    execSync("pnpm tsx scripts/__e2e-billing.ts", { stdio: "pipe" });
  } finally {
    rmSync("scripts/__e2e-billing.ts", { force: true });
  }

  const [invoice] = await sql`
    select id, status, total_cents from invoices
    where service_id = ${serviceId} order by created_at desc limit 1`;
  expect(invoice).toBeTruthy();
  expect(invoice.status).toBe("open");
  expect(Number(invoice.total_cents)).toBe(38200); // VoIP Basic monthly

  // Settle by manual EFT through the domain (same path the admin UI uses).
  const settle = `
    import { config } from "dotenv"; config({ path: [".env.local", ".env"] });
    import Module from "node:module"; import path from "node:path";
    const m = Module as any; const orig = m._resolveFilename;
    m._resolveFilename = function (r: string, ...a: unknown[]) {
      return r === "server-only" ? path.join(process.cwd(), "scripts/noop.js") : orig.call(this, r, ...a);
    };
    (async () => {
      const { db } = await import("../lib/db/client");
      const schema = await import("../lib/db/schema");
      const { eq } = await import("drizzle-orm");
      const { recordManualPayment } = await import("../lib/domain/billing");
      const [admin] = await db.select().from(schema.users).where(eq(schema.users.role, "admin")).limit(1);
      await recordManualPayment(
        { userId: admin.id, role: "admin" },
        { invoiceId: ${JSON.stringify("__INVOICE__")}, amountCents: 38200, reference: "E2E-EFT-" + Date.now() }
      );
      process.exit(0);
    })();
  `.replace('"__INVOICE__"', JSON.stringify(String(invoice.id)));
  writeFileSync("scripts/__e2e-settle.ts", settle);
  try {
    execSync("pnpm tsx scripts/__e2e-settle.ts", { stdio: "pipe" });
  } finally {
    rmSync("scripts/__e2e-settle.ts", { force: true });
  }

  const [paid] = await sql`select status from invoices where id = ${invoice.id}`;
  expect(paid.status).toBe("paid");
});

test.afterAll(async () => {
  await sql.end();
});
