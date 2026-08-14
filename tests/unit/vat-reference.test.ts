import { describe, it, expect } from "vitest";
import { vatFromGross, splitInvoiceVat, type VatSettings } from "@/lib/domain/vat";

/**
 * Reference vectors for VAT-inclusive pricing at 15%, computed independently
 * with exact rational arithmetic before reading the implementation, so a
 * disagreement condemns the implementation rather than the test.
 *
 * The client confirmed on 2026-08-05: registered, prices VAT inclusive, 15%.
 * The VAT inside a gross amount is gross * 1500 / 11500, rounded once.
 */
const RATE = 1500;

describe("VAT inside a VAT-inclusive amount, at 15%", () => {
  const vectors: [number, number][] = [
    [38800, 5061],   // R388.00, the LTE Starter plan
    [33100, 4317],   // R331.00, Telkom LTE Starter
    [183300, 23909], // R1 833.00, the LTE once-off
    [76400, 9965],   // R764.00, a first payment
    [52100, 6796],
    [107700, 14048],
    [64000, 8348],
    [100, 13],       // R1.00
    [1, 0],          // one cent: the VAT rounds away, and must not go negative
  ];

  it.each(vectors)("gross %i cents carries %i cents of VAT", (gross, want) => {
    expect(vatFromGross(gross, RATE)).toBe(want);
  });

  it("never loses or invents a cent: net plus VAT equals gross", () => {
    for (const [gross] of vectors) {
      const vat = vatFromGross(gross, RATE);
      expect(gross - vat + vat).toBe(gross);
      expect(vat).toBeGreaterThanOrEqual(0);
      expect(vat).toBeLessThan(gross || 1);
    }
  });

  it("handles a credit line without flipping the sign of the VAT", () => {
    // Plan-change downgrades issue a negative pro-rata credit.
    expect(vatFromGross(-38800, RATE)).toBe(-5061);
  });
});

const REGISTERED: VatSettings = {
  registered: true,
  rateBasisPoints: RATE,
  pricesIncludeVat: true,
};

describe("per-line VAT sums exactly to the invoice VAT", () => {
  it("loses no cent across lines that would each round the same way", () => {
    // Three lines that individually round up; a naive per-line round would
    // overstate the invoice VAT by a cent or more.
    const split = splitInvoiceVat([33333, 33333, 33334], REGISTERED);
    const summed = split.lines.reduce((t, l) => t + l.vatCents, 0);
    expect(summed).toBe(split.vatCents);
    expect(split.subtotalCents + (split.vatCents ?? 0)).toBe(100000);
  });

  it("agrees with the whole-invoice figure on a realistic invoice", () => {
    const split = splitInvoiceVat([38800, 183300], REGISTERED);
    expect(split.vatCents).toBe(vatFromGross(222100, RATE));
    expect(split.lines.reduce((t, l) => t + l.vatCents, 0)).toBe(split.vatCents);
  });
});
