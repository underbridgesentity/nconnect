import { describe, it, expect } from "vitest";
import { computeUpgradeAdjustment } from "@/lib/domain/billing-engine";

/**
 * §5 upgrade maths: credit unused days of the old plan + charge remaining
 * days of the new plan. Integer-exact across month lengths, clamping and
 * rounding (M4 acceptance).
 */
describe("computeUpgradeAdjustment", () => {
  it("mid-period upgrade in a 31-day period", () => {
    // Telkom LTE Starter (R331) -> Plus (R654), period 18 Jul to 18 Aug (31d),
    // upgrading on 28 Jul (10 days used, 21 remaining).
    const adj = computeUpgradeAdjustment(
      33100,
      65400,
      "2026-07-18",
      "2026-08-18",
      "2026-07-28"
    );
    expect(adj.daysInPeriod).toBe(31);
    expect(adj.daysUsed).toBe(10);
    expect(adj.daysRemaining).toBe(21);
    // Credit: exact complement of 10/31 of R331.
    expect(adj.creditCents).toBe(-(33100 - Math.trunc((33100 * 10) / 31)));
    expect(adj.chargeCents).toBe(65400 - Math.trunc((65400 * 10) / 31));
    expect(adj.netCents).toBe(adj.creditCents + adj.chargeCents);
    expect(adj.netCents).toBeGreaterThan(0);
  });

  it("credit + old-plan-used always reconstructs the old monthly price exactly", () => {
    for (const [oldP, newP] of [
      [33100, 65400],
      [38800, 52100],
      [52100, 107700],
    ]) {
      for (const [start, end] of [
        ["2026-01-15", "2026-02-15"], // 31d
        ["2026-02-10", "2026-03-10"], // 28d
        ["2026-04-01", "2026-05-01"], // 30d
        ["2024-02-05", "2024-03-05"], // 29d leap
      ]) {
        const days = Math.round(
          (Date.parse(end) - Date.parse(start)) / 86_400_000
        );
        for (let used = 0; used <= days; used++) {
          const today = new Date(Date.parse(start) + used * 86_400_000)
            .toISOString()
            .slice(0, 10);
          const adj = computeUpgradeAdjustment(oldP, newP, start, end, today);
          // The credited amount plus what the customer effectively consumed
          // must equal the old monthly price to the cent.
          const consumedOld = oldP + adj.creditCents;
          expect(consumedOld).toBe(Math.trunc((oldP * used) / days));
          // And the new-plan charge is the exact complement at the new rate.
          expect(adj.chargeCents).toBe(newP - Math.trunc((newP * used) / days));
        }
      }
    }
  });

  it("upgrade on day 0 credits the full old month and charges the full new month", () => {
    const adj = computeUpgradeAdjustment(
      33100,
      65400,
      "2026-07-18",
      "2026-08-18",
      "2026-07-18"
    );
    expect(adj.creditCents).toBe(-33100);
    expect(adj.chargeCents).toBe(65400);
    expect(adj.netCents).toBe(32300);
  });

  it("clamps today before period start and after period end", () => {
    const early = computeUpgradeAdjustment(
      33100, 65400, "2026-07-18", "2026-08-18", "2026-07-01"
    );
    expect(early.daysUsed).toBe(0);
    const late = computeUpgradeAdjustment(
      33100, 65400, "2026-07-18", "2026-08-18", "2026-09-01"
    );
    expect(late.daysUsed).toBe(31);
    expect(late.chargeCents === 0).toBe(true);
    expect(late.creditCents === 0).toBe(true);
  });
});
