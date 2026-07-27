import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * appUrl() is the single source for canonical URLs, notification links and
 * PayFast return URLs. The guard has to catch a genuinely missing or insecure
 * production origin without breaking a local `next build`, which also runs
 * with NODE_ENV=production.
 */
async function load() {
  vi.resetModules();
  return (await import("@/lib/config")).appUrl;
}

const ENV = { ...process.env };
beforeEach(() => {
  delete process.env.APP_URL;
  delete process.env.VERCEL;
  delete process.env.VERCEL_URL;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
});
afterEach(() => {
  process.env = { ...ENV };
});

describe("appUrl", () => {
  it("uses APP_URL and strips a trailing slash", async () => {
    process.env.APP_URL = "https://needdconnect.co.za/";
    expect((await load())()).toBe("https://needdconnect.co.za");
  });

  it("allows http on localhost so a local production build still works", async () => {
    process.env.APP_URL = "http://localhost:3000";
    expect((await load())()).toBe("http://localhost:3000");
  });

  it("rejects a plain-http public host", async () => {
    process.env.APP_URL = "http://needdconnect.co.za";
    await expect(async () => (await load())()).rejects.toThrow(/https/);
  });

  it("rejects a value that is not an absolute URL", async () => {
    process.env.APP_URL = "needdconnect.co.za";
    await expect(async () => (await load())()).rejects.toThrow(/absolute URL/);
  });

  it("falls back to the Vercel production host", async () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "needdconnect.co.za";
    expect((await load())()).toBe("https://needdconnect.co.za");
  });

  it("throws when deployed with no origin at all", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.VERCEL = "1";
    await expect(async () => (await load())()).rejects.toThrow(/APP_URL is not set/);
    vi.unstubAllEnvs();
  });

  it("falls back to localhost off Vercel", async () => {
    expect((await load())()).toBe("http://localhost:3000");
  });
});
