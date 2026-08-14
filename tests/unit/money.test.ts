import { describe, it, expect } from "vitest";
import {
  add,
  subtract,
  multiply,
  percentOf,
  allocate,
  prorata,
  prorataComplement,
  formatCents,
  parseZar,
  rands,
} from "@/lib/money";

describe("money guards", () => {
  it("rejects non-integer amounts", () => {
    expect(() => add(100.5)).toThrow(TypeError);
    expect(() => multiply(100, 1.5)).toThrow(TypeError);
    expect(() => prorata(100.1, 1, 30)).toThrow(TypeError);
  });
});

describe("arithmetic", () => {
  it("adds and subtracts", () => {
    expect(add(38800, 183300)).toBe(222100);
    expect(subtract(183300, 38800)).toBe(144500);
    expect(add()).toBe(0);
  });

  it("multiplies by quantity", () => {
    expect(multiply(61100, 3)).toBe(183300);
  });

  it("percentOf rounds half-up at cent precision", () => {
    expect(percentOf(10000, 10)).toBe(1000);
    expect(percentOf(999, 10)).toBe(100); // 99.9 -> 100
    expect(percentOf(994, 10)).toBe(99); // 99.4 -> 99
    expect(percentOf(10000, 12.5)).toBe(1250);
    expect(percentOf(-10000, 10)).toBe(-1000);
  });

  it("percentOf never returns negative zero", () => {
    // Intl formats -0 as "-R 0,00", so a tiny negative percentage reaching a
    // customer document would show a credit that does not exist.
    expect(Object.is(percentOf(-1, 10), 0)).toBe(true);
    expect(Object.is(percentOf(-4, 10), 0)).toBe(true);
    expect(formatCents(percentOf(-1, 10))).toBe(formatCents(0));
  });
});

describe("allocate", () => {
  it("splits exactly with remainder on the last shares", () => {
    expect(allocate(100, 3)).toEqual([33, 33, 34]);
    expect(allocate(101, 3)).toEqual([33, 34, 34]);
    expect(allocate(99, 3)).toEqual([33, 33, 33]);
  });

  it("always sums to the input", () => {
    for (const amount of [0, 1, 97, 1000, 38800, 107700, 183299]) {
      for (const parts of [1, 2, 3, 7, 12, 28, 31]) {
        const shares = allocate(amount, parts);
        expect(shares.reduce((a, b) => a + b, 0)).toBe(amount);
      }
    }
  });

  it("handles negative amounts (credits)", () => {
    const shares = allocate(-100, 3);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(-100);
  });
});

describe("prorata", () => {
  it("computes daily-rate portions", () => {
    // R521.00 over a 31-day period, 10 days used
    expect(prorata(52100, 10, 31)).toBe(16806); // trunc(52100*10/31)
  });

  it("complement is exact for every month length and day", () => {
    for (const monthly of [38800, 52100, 63200, 74300, 107700, 33100, 117600]) {
      for (const daysInPeriod of [28, 29, 30, 31]) {
        for (let d = 0; d <= daysInPeriod; d++) {
          expect(
            prorata(monthly, d, daysInPeriod) +
              prorataComplement(monthly, d, daysInPeriod)
          ).toBe(monthly);
        }
      }
    }
  });

  it("full period equals the monthly amount, zero days equals zero", () => {
    expect(prorata(52100, 31, 31)).toBe(52100);
    expect(prorata(52100, 0, 31)).toBe(0);
  });

  it("rejects days outside the period", () => {
    expect(() => prorata(52100, 32, 31)).toThrow(RangeError);
  });
});

describe("formatting and parsing", () => {
  it("formats cents as ZAR", () => {
    expect(formatCents(38800)).toMatch(/R\s?388[.,]00/);
    expect(formatCents(183300, { whole: true })).toMatch(/R\s?1[\s ]?833/);
  });

  it("parses human ZAR strings", () => {
    expect(parseZar("R1 833")).toBe(183300);
    expect(parseZar("388")).toBe(38800);
    expect(parseZar("1833.50")).toBe(183350);
    expect(parseZar("-50.25")).toBe(-5025);
    expect(() => parseZar("abc")).toThrow(TypeError);
  });

  it("rands() converts whole rands", () => {
    expect(rands(388)).toBe(38800);
    expect(() => rands(388.5)).toThrow(TypeError);
  });
});

/**
 * parseZar must read back what formatCents writes. en-ZA uses a comma decimal
 * separator and a non-breaking space for thousands, so an operator pasting an
 * amount off any screen in this app hands parseZar "R1 234,56". Reading that
 * as R123 456,00 would post a hundredfold payment against a customer account.
 */
describe("parseZar across both grouping conventions", () => {
  it("reads South African formatting, including the app's own output", () => {
    expect(parseZar("R1 234,56")).toBe(123456);
    expect(parseZar("1.234,56")).toBe(123456);
    expect(parseZar("1 234,56")).toBe(123456);
    expect(parseZar(formatCents(123456))).toBe(123456);
    expect(parseZar(formatCents(183300, { whole: true }))).toBe(183300);
  });

  it("reads international formatting", () => {
    expect(parseZar("1,234.56")).toBe(123456);
    expect(parseZar("R1,234.56")).toBe(123456);
    expect(parseZar("1234.56")).toBe(123456);
  });

  it("treats a lone three-digit group as thousands, not decimals", () => {
    expect(parseZar("1,833")).toBe(183300);
    expect(parseZar("1.833")).toBe(183300);
  });

  it("handles negatives written either side", () => {
    expect(parseZar("-1 234,56")).toBe(-123456);
    expect(parseZar("1 234,56-")).toBe(-123456);
  });

  it("still rejects junk rather than guessing", () => {
    for (const bad of ["abc", "1.2.3.4", "12,34,56", "R", ""]) {
      expect(() => parseZar(bad)).toThrow(TypeError);
    }
  });
});
