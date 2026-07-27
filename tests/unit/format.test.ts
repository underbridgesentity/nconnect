import { describe, it, expect } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatTime,
  formatDateLong,
  formatRelative,
  formatAge,
} from "@/lib/format";

/**
 * Spec §2: timestamps are stored UTC and displayed in Africa/Johannesburg.
 * The cases either side of midnight are the ones that actually bite, because a
 * bare toLocaleDateString() on a UTC server shows the previous day to a South
 * African customer. These tests pin that behaviour.
 */
describe("display formatting", () => {
  const lateUtc = "2026-07-27T23:30:00Z"; // 01:30 on the 28th in SAST
  const earlyUtc = "2026-07-27T05:15:00Z"; // 07:15 on the 27th in SAST

  it("rolls a late-evening UTC instant into the next SAST day", () => {
    expect(formatDate(lateUtc)).toBe("28 Jul 2026");
    expect(formatTime(lateUtc)).toBe("01:30");
    expect(formatDateTime(lateUtc)).toBe("28 Jul 2026, 01:30");
  });

  it("offsets a morning instant by two hours", () => {
    expect(formatDate(earlyUtc)).toBe("27 Jul 2026");
    expect(formatTime(earlyUtc)).toBe("07:15");
  });

  it("is independent of the machine time zone", () => {
    // Same instant expressed three ways must format identically.
    const asDate = new Date(lateUtc);
    const asEpoch = asDate.getTime();
    expect(formatDate(asDate)).toBe(formatDate(lateUtc));
    expect(formatDate(asEpoch)).toBe(formatDate(lateUtc));
  });

  it("keeps date-only values on their calendar day", () => {
    expect(formatDate("2026-07-27")).toBe("27 Jul 2026");
    expect(formatDateLong("2026-07-27")).toBe("27 July 2026");
  });

  it("returns the fallback for empty and invalid input", () => {
    for (const value of [null, undefined, "", "not-a-date"]) {
      expect(formatDate(value)).toBe("-");
      expect(formatDateTime(value)).toBe("-");
    }
    expect(formatDate(null, "Not set")).toBe("Not set");
  });

  it("formats relative time against an explicit now", () => {
    const now = "2026-07-27T12:00:00Z";
    expect(formatRelative("2026-07-27T09:00:00Z", now)).toBe("3 hours ago");
    expect(formatRelative("2026-07-29T12:00:00Z", now)).toBe("in 2 days");
    expect(formatRelative("2026-07-26T12:00:00Z", now)).toBe("yesterday");
  });

  it("formats a compact waiting age for operator queues", () => {
    const now = "2026-07-27T12:00:00Z";
    expect(formatAge("2026-07-27T11:56:00Z", now)).toBe("4m");
    expect(formatAge("2026-07-27T09:00:00Z", now)).toBe("3h");
    expect(formatAge("2026-07-25T12:00:00Z", now)).toBe("2d");
    // A future timestamp clamps to zero rather than rendering a negative age.
    expect(formatAge("2026-07-27T12:30:00Z", now)).toBe("0m");
  });
});
