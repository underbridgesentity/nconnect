import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The protections that make a duplicate cron fire harmless.
 *
 * Vercel does not promise exactly-once delivery: a cron can fire twice, and a
 * deploy or a retry can land a second call in the same slot. The jobs are all
 * idempotent underneath, but "idempotent underneath" is a claim about code
 * that can be broken by an edit, so the cheap outer guards are tested here in
 * their own right. Both are pure functions of a stored timestamp, which is
 * what makes them testable without a database.
 */

const heartbeats: Record<string, { at: string; source: string }> = {};

vi.mock("@/lib/db/client", () => ({
  db: {},
  schema: {},
}));
vi.mock("@/lib/domain/settings", () => ({
  getSetting: async () => heartbeats,
}));

const { ranOnDate, ranWithinMinutes } = await import("@/lib/domain/ops-health");
const { gateCronRequest } = await import("@/lib/jobs/cron-auth");

beforeEach(() => {
  for (const key of Object.keys(heartbeats)) delete heartbeats[key];
});

describe("ranOnDate, the daily stand-down guard", () => {
  it("stands the run down when today already has a heartbeat", async () => {
    // 03:00 SAST on 2026-08-15 is 01:00 UTC the same day.
    heartbeats["billing-run"] = {
      at: "2026-08-15T01:00:00.000Z",
      source: "vercel-cron",
    };
    expect(await ranOnDate("billing-run", "2026-08-15")).toBe(true);
  });

  it("lets the next night run", async () => {
    heartbeats["billing-run"] = {
      at: "2026-08-15T01:00:00.000Z",
      source: "vercel-cron",
    };
    expect(await ranOnDate("billing-run", "2026-08-16")).toBe(false);
  });

  it("compares in Africa/Johannesburg, not UTC", async () => {
    // 23:30 UTC on the 14th is 01:30 SAST on the 15th. Comparing in UTC would
    // call this yesterday's run and bill the book a second time.
    heartbeats["billing-run"] = {
      at: "2026-08-14T23:30:00.000Z",
      source: "vercel-cron",
    };
    expect(await ranOnDate("billing-run", "2026-08-15")).toBe(true);
  });

  it("runs when nothing has ever been recorded", async () => {
    expect(await ranOnDate("billing-run", "2026-08-15")).toBe(false);
  });

  it("runs rather than stalls forever on an unparseable heartbeat", async () => {
    heartbeats["billing-run"] = { at: "not a date", source: "vercel-cron" };
    expect(await ranOnDate("billing-run", "2026-08-15")).toBe(false);
  });
});

describe("ranWithinMinutes, the hourly stand-down guard", () => {
  it("stands down a duplicate fire in the same slot", async () => {
    heartbeats["abandoned-signups"] = {
      at: new Date(Date.now() - 5_000).toISOString(),
      source: "vercel-cron",
    };
    expect(await ranWithinMinutes("abandoned-signups", 50)).toBe(true);
  });

  it("lets the next hour through", async () => {
    heartbeats["abandoned-signups"] = {
      at: new Date(Date.now() - 58 * 60_000).toISOString(),
      source: "vercel-cron",
    };
    expect(await ranWithinMinutes("abandoned-signups", 50)).toBe(false);
  });

  it("still lets the next hour through after a run that finished late", async () => {
    // Fired at the top of the hour, finished six minutes later. The next
    // hourly fire is 54 minutes after that heartbeat and must not be
    // suppressed, which is why the window is 50 and not 60.
    heartbeats["abandoned-signups"] = {
      at: new Date(Date.now() - 54 * 60_000).toISOString(),
      source: "vercel-cron",
    };
    expect(await ranWithinMinutes("abandoned-signups", 50)).toBe(false);
  });

  it("runs when nothing has ever been recorded", async () => {
    expect(await ranWithinMinutes("abandoned-signups", 50)).toBe(false);
  });

  it("treats a heartbeat dated in the future as recent", async () => {
    // A clock skewed forward should not turn the guard off entirely.
    heartbeats["abandoned-signups"] = {
      at: new Date(Date.now() + 10 * 60_000).toISOString(),
      source: "vercel-cron",
    };
    expect(await ranWithinMinutes("abandoned-signups", 50)).toBe(true);
  });
});

describe("gateCronRequest", () => {
  const request = (headers: Record<string, string>) =>
    new Request("https://www.needdconnect.co.za/api/cron/billing", { headers });

  it("refuses to run at all when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const gate = gateCronRequest(
      request({ authorization: "Bearer anything" }),
      "the nightly billing run"
    );
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.response.status).toBe(503);
    const body = await gate.response.json();
    // Naming the job matters: the 503 is the only thing anyone reads when a
    // schedule silently does nothing.
    expect(body.code).toBe("cron_not_configured");
    expect(body.message).toContain("the nightly billing run");
    vi.unstubAllEnvs();
  });

  it("rejects a wrong secret and accepts the right one", () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    expect(
      gateCronRequest(request({ authorization: "Bearer wrong" }), "job").ok
    ).toBe(false);
    expect(
      gateCronRequest(request({ authorization: "Bearer s3cret-value" }), "job")
        .ok
    ).toBe(true);
    vi.unstubAllEnvs();
  });

  it("rejects a request with no credential at all", () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    const gate = gateCronRequest(request({}), "job");
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.response.status).toBe(401);
    vi.unstubAllEnvs();
  });

  it("accepts the x-cron-secret header for hand-run checks", () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    expect(
      gateCronRequest(request({ "x-cron-secret": "s3cret-value" }), "job").ok
    ).toBe(true);
    vi.unstubAllEnvs();
  });

  it("does not leak the secret's length through a prefix match", () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    expect(
      gateCronRequest(request({ authorization: "Bearer s3cret" }), "job").ok
    ).toBe(false);
    expect(
      gateCronRequest(
        request({ authorization: "Bearer s3cret-value-and-more" }),
        "job"
      ).ok
    ).toBe(false);
    vi.unstubAllEnvs();
  });
});
