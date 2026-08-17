// Is the hang specific to billing, or does any DB-backed page stall at random?
// Repeats each route N times with a short abort and reports the hang rate. A
// static public route is included as a control: if it never hangs but every
// DB-backed route does, the fault is the database connection, not the markup.
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "https://www.needdconnect.co.za";
const ROUNDS = Number(process.env.ROUNDS ?? 4);
const ABORT_MS = Number(process.env.ABORT_MS ?? 25_000);

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

const routes = [
  "/",                        // control: public, no session query
  "/admin",
  "/admin/reports",
  "/admin/billing",
  "/admin/customers",
  "/admin/services",
];

const stats = new Map(routes.map((r) => [r, { ok: 0, hung: 0, times: [] }]));

for (let round = 0; round < ROUNDS; round++) {
  for (const route of routes) {
    const t0 = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ABORT_MS);
    const s = stats.get(route);
    try {
      const res = await fetch(`${BASE}${route}`, {
        headers: { cookie, "user-agent": "nconnect-probe" },
        signal: controller.signal,
        redirect: "manual",
      });
      await res.text();
      s.ok++;
      s.times.push(Date.now() - t0);
    } catch {
      s.hung++;
    } finally {
      clearTimeout(timer);
    }
  }
  process.stdout.write(`round ${round + 1}/${ROUNDS} done\n`);
}

for (const [route, s] of stats) {
  const avg = s.times.length
    ? Math.round(s.times.reduce((a, b) => a + b, 0) / s.times.length)
    : 0;
  console.log(
    `${route.padEnd(20)} ok=${s.ok} hung=${s.hung} avg=${avg}ms max=${s.times.length ? Math.max(...s.times) : 0}ms`
  );
}
