// One request, lots of patience, nothing else in flight. Aborting a request
// does not stop the server working on it, so a probe that gives up early can
// manufacture the very pile-up it is trying to measure. This one waits.
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "https://www.needdconnect.co.za";
const ROUTE = process.env.ROUTE ?? "/admin/billing";
const WAIT_MS = Number(process.env.WAIT_MS ?? 300_000);

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`${BASE}/staff-login`, { waitUntil: "domcontentloaded" });
await page.fill('input[type="email"]', process.env.ADMIN_EMAIL ?? "admin@needdconnect.co.za");
await page.fill('input[type="password"]', process.env.ADMIN_PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL(/\/admin(\/|$)/, { timeout: 60_000 });
const cookie = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
await browser.close();

console.log(`waiting up to ${WAIT_MS / 1000}s for ${ROUTE} ...`);
const t0 = Date.now();
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), WAIT_MS);
try {
  const res = await fetch(`${BASE}${ROUTE}`, {
    headers: { cookie, "user-agent": "nconnect-probe" },
    signal: controller.signal,
    redirect: "manual",
  });
  console.log(`headers at ${Date.now() - t0}ms, status ${res.status}`);
  const body = await res.text();
  console.log(`body complete at ${Date.now() - t0}ms, ${body.length} bytes`);
  console.log(`contains "Loading": ${body.includes("Loading")}`);
  const err = /error|Something went wrong|digest/i.exec(body)?.[0];
  if (err) console.log(`body mentions: ${err}`);
} catch (e) {
  console.log(`gave up after ${Date.now() - t0}ms: ${String(e).split("\n")[0]}`);
} finally {
  clearTimeout(timer);
}
