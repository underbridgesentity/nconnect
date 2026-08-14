import { describe, it, expect } from "vitest";
import {
  DEFAULT_VAT,
  VAT_SETTING_KEY,
  formatVatRate,
  isTaxInvoice,
  issueRateBasisPoints,
  parseVatSettings,
  pricingTermsSentence,
  showsVatNumber,
  splitAdditionalAmount,
  splitInvoiceVat,
  vatFromGross,
  vatFromNet,
  vatLineLabel,
  type VatSettings,
} from "@/lib/domain/vat";

const NOT_REGISTERED: VatSettings = DEFAULT_VAT;
const INCLUSIVE_15: VatSettings = {
  registered: true,
  rateBasisPoints: 1500,
  pricesIncludeVat: true,
};
const EXCLUSIVE_15: VatSettings = {
  registered: true,
  rateBasisPoints: 1500,
  pricesIncludeVat: false,
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("the setting", () => {
  it("is keyed 'vat' and defaults to not registered", () => {
    expect(VAT_SETTING_KEY).toBe("vat");
    expect(DEFAULT_VAT).toEqual({
      registered: false,
      rateBasisPoints: 0,
      pricesIncludeVat: true,
    });
  });

  it("falls back to not registered rather than guessing a rate", () => {
    // Anything unusable is treated as "no VAT". Charging a guessed rate on a
    // customer document is the failure mode worth engineering against.
    expect(parseVatSettings(null)).toEqual(DEFAULT_VAT);
    expect(parseVatSettings({ registered: true })).toEqual(DEFAULT_VAT);
    expect(parseVatSettings("15%")).toEqual(DEFAULT_VAT);
    expect(
      parseVatSettings({
        registered: true,
        rateBasisPoints: 15,
        pricesIncludeVat: true,
      })
    ).toEqual({
      registered: true,
      rateBasisPoints: 15,
      pricesIncludeVat: true,
    });
  });

  it("rejects a float percent smuggled in as basis points", () => {
    expect(
      parseVatSettings({
        registered: true,
        rateBasisPoints: 15.5,
        pricesIncludeVat: true,
      })
    ).toEqual(DEFAULT_VAT);
  });

  it("rejects a rate above 100%", () => {
    expect(
      parseVatSettings({
        registered: true,
        rateBasisPoints: 10_001,
        pricesIncludeVat: true,
      })
    ).toEqual(DEFAULT_VAT);
  });

  it("snapshots no rate at all while the company is not registered", () => {
    expect(issueRateBasisPoints(NOT_REGISTERED)).toBeNull();
    expect(issueRateBasisPoints(INCLUSIVE_15)).toBe(1500);
    // A registered vendor issuing a zero-rated invoice still snapshots 0,
    // which says "a VAT vendor issued this", not "there is no VAT regime".
    expect(
      issueRateBasisPoints({
        registered: true,
        rateBasisPoints: 0,
        pricesIncludeVat: true,
      })
    ).toBe(0);
  });
});

describe("not registered: nothing is computed and nothing is claimed", () => {
  it("leaves every amount exactly as priced and every VAT field null", () => {
    const split = splitInvoiceVat([38800, 15000, -2000], NOT_REGISTERED);
    expect(split.vatRateBasisPoints).toBeNull();
    expect(split.vatCents).toBeNull();
    expect(split.subtotalCents).toBe(51800);
    expect(split.totalCents).toBe(51800);
    expect(split.lines.map((l) => l.amountCents)).toEqual([38800, 15000, -2000]);
    expect(split.lines.every((l) => l.vatCents === null)).toBe(true);
    expect(split.lines.every((l) => l.vatRateBasisPoints === null)).toBe(true);
  });

  it("produces an invoice that is not a tax invoice and prints no VAT number", () => {
    const split = splitInvoiceVat([38800], NOT_REGISTERED);
    expect(isTaxInvoice(split)).toBe(false);
    expect(showsVatNumber(split)).toBe(false);
  });

  it("treats a legacy invoice row, all nulls, the same way", () => {
    const legacy = { vatRateBasisPoints: null, vatCents: null };
    expect(isTaxInvoice(legacy)).toBe(false);
    expect(showsVatNumber(legacy)).toBe(false);
  });

  it("counts a zero-rated invoice from a registered vendor as a tax invoice", () => {
    expect(isTaxInvoice({ vatRateBasisPoints: 0, vatCents: 0 })).toBe(true);
    expect(showsVatNumber({ vatRateBasisPoints: 0, vatCents: 0 })).toBe(true);
  });
});

describe("the inclusive and exclusive formulas", () => {
  it("extracts VAT from a gross amount", () => {
    // R388.00 inclusive at 15%: 38800 * 1500 / 11500 = 5060.869..., so R50.61.
    expect(vatFromGross(38800, 1500)).toBe(5061);
    expect(38800 - vatFromGross(38800, 1500)).toBe(33739);
  });

  it("adds VAT to a net amount", () => {
    expect(vatFromNet(33739, 1500)).toBe(5061);
    expect(33739 + vatFromNet(33739, 1500)).toBe(38800);
  });

  it("returns zero at a zero rate without dividing by anything odd", () => {
    expect(vatFromGross(38800, 0)).toBe(0);
    expect(vatFromNet(38800, 0)).toBe(0);
  });

  it("rounds half-up, decided by integers rather than a float", () => {
    // Exclusive at 15%: 10c of net is exactly 1.5c of VAT, 30c is exactly 4.5c.
    expect(vatFromNet(10, 1500)).toBe(2);
    expect(vatFromNet(30, 1500)).toBe(5);
    expect(vatFromNet(-10, 1500)).toBe(-2);
    expect(vatFromNet(-30, 1500)).toBe(-5);
    // Inclusive at 100%: 1c gross is exactly half a cent of VAT.
    expect(vatFromGross(1, 10_000)).toBe(1);
    expect(vatFromGross(-1, 10_000)).toBe(-1);
  });

  it("rounds a credit as the exact mirror of the charge it reverses", () => {
    for (const amount of [1, 7, 10, 33, 38800, 65400, 123_456]) {
      expect(vatFromGross(-amount, 1500) + vatFromGross(amount, 1500)).toBe(0);
      expect(vatFromNet(-amount, 1500) + vatFromNet(amount, 1500)).toBe(0);
    }
  });

  it("never returns negative zero, which Intl prints as '-R 0,00'", () => {
    // A cent of credit carries no VAT at 15%. Handing back -0 here would put
    // a credit that does not exist on a customer's invoice.
    expect(Object.is(vatFromGross(-1, 1500), 0)).toBe(true);
    expect(Object.is(vatFromNet(-1, 1500), 0)).toBe(true);
    expect(Object.is(splitInvoiceVat([-1], INCLUSIVE_15).vatCents, 0)).toBe(
      true
    );
  });

  it("refuses anything that is not integer cents or a sane rate", () => {
    expect(() => vatFromGross(100.5, 1500)).toThrow(TypeError);
    expect(() => vatFromNet(100.5, 1500)).toThrow(TypeError);
    expect(() => vatFromGross(100, 15.5)).toThrow(TypeError);
    expect(() => vatFromGross(100, -1)).toThrow(TypeError);
    expect(() => vatFromGross(100, 10_001)).toThrow(TypeError);
  });
});

describe("a single cent", () => {
  it("carries no VAT at 15% inclusive, and the cent stays with the net", () => {
    const split = splitInvoiceVat([1], INCLUSIVE_15);
    expect(split.vatCents).toBe(0);
    expect(split.subtotalCents).toBe(1);
    expect(split.totalCents).toBe(1);
    expect(split.lines[0]).toMatchObject({
      amountCents: 1,
      vatCents: 0,
      grossCents: 1,
    });
  });

  it("carries no VAT at 15% exclusive either", () => {
    const split = splitInvoiceVat([1], EXCLUSIVE_15);
    expect(split.vatCents).toBe(0);
    expect(split.subtotalCents).toBe(1);
    expect(split.totalCents).toBe(1);
  });

  it("still reconciles when a cent of VAT does appear", () => {
    // 4c exclusive at 15% is 0.6c, which rounds up to a whole cent.
    const split = splitInvoiceVat([4], EXCLUSIVE_15);
    expect(split.vatCents).toBe(1);
    expect(split.subtotalCents).toBe(4);
    expect(split.totalCents).toBe(5);
  });
});

describe("VAT that lands on a half cent", () => {
  it("rounds the invoice up, once, and the lines follow it", () => {
    // Exclusive: 10c + 10c + 10c = 30c net, exactly 4.5c of VAT.
    const split = splitInvoiceVat([10, 10, 10], EXCLUSIVE_15);
    expect(split.vatCents).toBe(5);
    expect(sum(split.lines.map((l) => l.vatCents ?? 0))).toBe(5);
    expect(split.subtotalCents).toBe(30);
    expect(split.totalCents).toBe(35);
  });

  it("rounds a half-cent credit invoice down in magnitude, not up", () => {
    const split = splitInvoiceVat([-30], EXCLUSIVE_15);
    expect(split.vatCents).toBe(-5);
    expect(split.totalCents).toBe(-35);
  });
});

describe("many lines that would each round the same way", () => {
  it("does not multiply a rounding-up by the number of lines", () => {
    // Ten lines of 10c net at 15%. Each line is exactly 1.5c of VAT, so
    // rounding line by line would charge 20c of VAT on R1.00 of net, a 33%
    // overcharge. The invoice is rounded once, at 15c, and the lines are
    // reconciled to it.
    const split = splitInvoiceVat(Array(10).fill(10), EXCLUSIVE_15);
    expect(split.subtotalCents).toBe(100);
    expect(split.vatCents).toBe(15);
    expect(split.totalCents).toBe(115);
    expect(sum(split.lines.map((l) => l.vatCents ?? 0))).toBe(15);
    // Largest remainder, ties broken by position: the first five lines take
    // the extra cent each. Deterministic, so two runs never disagree.
    expect(split.lines.map((l) => l.vatCents)).toEqual([
      2, 2, 2, 2, 2, 1, 1, 1, 1, 1,
    ]);
  });

  it("keeps a hundred one-cent lines summing to the invoice VAT", () => {
    const split = splitInvoiceVat(Array(100).fill(1), INCLUSIVE_15);
    expect(split.totalCents).toBe(100);
    expect(split.vatCents).toBe(vatFromGross(100, 1500));
    expect(sum(split.lines.map((l) => l.vatCents ?? 0))).toBe(split.vatCents);
    expect(sum(split.lines.map((l) => l.amountCents))).toBe(split.subtotalCents);
  });

  it("gives ten one-cent lines the single cent of VAT the invoice carries", () => {
    const split = splitInvoiceVat(Array(10).fill(1), INCLUSIVE_15);
    expect(split.totalCents).toBe(10);
    expect(split.vatCents).toBe(1);
    expect(sum(split.lines.map((l) => l.vatCents ?? 0))).toBe(1);
  });
});

describe("a credit line on a plan change", () => {
  it("splits an upgrade adjustment without losing a cent either way", () => {
    // The shape lib/domain/billing-engine produces on an upgrade: a negative
    // credit for the old plan's unused days beside a charge for the new one.
    const split = splitInvoiceVat([-10_000, 12_000], INCLUSIVE_15);
    expect(split.totalCents).toBe(2_000);
    expect(split.vatCents).toBe(261);
    expect(split.subtotalCents).toBe(1_739);
    expect(split.lines.map((l) => l.vatCents)).toEqual([-1304, 1565]);
    expect(sum(split.lines.map((l) => l.vatCents ?? 0))).toBe(261);
    expect(sum(split.lines.map((l) => l.amountCents))).toBe(1_739);
    // The credit line stays a credit, in net and in VAT.
    expect(split.lines[0].amountCents).toBeLessThan(0);
    expect(split.lines[0].vatCents!).toBeLessThan(0);
  });

  it("handles a downgrade adjustment that nets to a credit", () => {
    const split = splitInvoiceVat([-12_000, 10_000], INCLUSIVE_15);
    expect(split.totalCents).toBe(-2_000);
    expect(split.subtotalCents! + split.vatCents!).toBe(-2_000);
    expect(sum(split.lines.map((l) => l.vatCents ?? 0))).toBe(split.vatCents);
    expect(sum(split.lines.map((l) => l.amountCents))).toBe(split.subtotalCents);
  });

  it("handles an adjustment that nets to exactly zero", () => {
    const split = splitInvoiceVat([-33_100, 33_100], INCLUSIVE_15);
    expect(split.totalCents).toBe(0);
    expect(split.subtotalCents).toBe(0);
    expect(split.vatCents).toBe(0);
    expect(sum(split.lines.map((l) => l.vatCents ?? 0))).toBe(0);
    expect(split.lines[0].vatCents).toBe(-split.lines[1].vatCents!);
  });
});

describe("the invariants every invoice must hold", () => {
  it("keeps inclusive pricing charging exactly what the catalogue says", () => {
    // The customer bought a R388.00 plan. They pay R388.00. VAT is found
    // inside that, never added on top of it.
    const split = splitInvoiceVat([38800], INCLUSIVE_15);
    expect(split.totalCents).toBe(38800);
    expect(split.subtotalCents).toBe(33739);
    expect(split.vatCents).toBe(5061);
    expect(split.lines[0].amountCents).toBe(33739);
    expect(split.lines[0].grossCents).toBe(38800);
  });

  it("keeps exclusive pricing adding VAT on top", () => {
    const split = splitInvoiceVat([38800], EXCLUSIVE_15);
    expect(split.subtotalCents).toBe(38800);
    expect(split.vatCents).toBe(5820);
    expect(split.totalCents).toBe(44620);
    expect(split.lines[0].amountCents).toBe(38800);
    expect(split.lines[0].grossCents).toBe(44620);
  });

  it("reconciles across a wide sweep of amounts, rates and line counts", () => {
    // Deterministic pseudo-random, so a failure is reproducible rather than a
    // once-in-a-thousand mystery on CI.
    let seed = 20260814;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const rates = [0, 1, 500, 1400, 1500, 1550, 2000, 9999, 10_000];

    for (let trial = 0; trial < 4000; trial++) {
      const rateBasisPoints = rates[next(rates.length)];
      const pricesIncludeVat = next(2) === 0;
      const settings: VatSettings = {
        registered: true,
        rateBasisPoints,
        pricesIncludeVat,
      };
      const lineCount = 1 + next(8);
      const amounts = Array.from({ length: lineCount }, () => {
        const magnitude = next(200_000);
        return next(4) === 0 ? -magnitude : magnitude;
      });

      const split = splitInvoiceVat(amounts, settings);
      const priced = sum(amounts);

      expect(sum(split.lines.map((l) => l.amountCents))).toBe(
        split.subtotalCents
      );
      expect(sum(split.lines.map((l) => l.vatCents ?? 0))).toBe(split.vatCents);
      expect(split.subtotalCents + split.vatCents!).toBe(split.totalCents);
      expect(sum(split.lines.map((l) => l.grossCents))).toBe(split.totalCents);
      // Inclusive pricing must never change what the customer pays; exclusive
      // pricing must never change the net that was quoted.
      expect(pricesIncludeVat ? split.totalCents : split.subtotalCents).toBe(
        priced
      );
      // Every line's VAT is within a cent of its own exact share, so no single
      // line absorbs the whole reconciliation.
      for (let i = 0; i < amounts.length; i++) {
        const denominator = pricesIncludeVat
          ? 10_000 + rateBasisPoints
          : 10_000;
        const exact = (amounts[i] * rateBasisPoints) / denominator;
        expect(Math.abs((split.lines[i].vatCents ?? 0) - exact)).toBeLessThan(2);
      }
    }
  });

  it("handles an invoice with no lines at all", () => {
    const split = splitInvoiceVat([], INCLUSIVE_15);
    expect(split.subtotalCents).toBe(0);
    expect(split.vatCents).toBe(0);
    expect(split.totalCents).toBe(0);
    expect(split.lines).toEqual([]);
  });
});

describe("an amount added after issue", () => {
  it("uses the invoice's snapshotted rate, not today's setting", () => {
    // A goodwill credit posted against an invoice issued at 15% must be split
    // at 15%, even if the rate has since changed.
    const invoice = { vatRateBasisPoints: 1500, vatCents: 5061 };
    const credit = splitAdditionalAmount(-11_500, invoice, {
      pricesIncludeVat: true,
    });
    expect(credit.grossCents).toBe(-11_500);
    expect(credit.vatCents).toBe(-1500);
    expect(credit.amountCents).toBe(-10_000);
  });

  it("adds no VAT to an invoice that never carried any", () => {
    const legacy = { vatRateBasisPoints: null, vatCents: null };
    const credit = splitAdditionalAmount(-11_500, legacy, {
      pricesIncludeVat: true,
    });
    expect(credit.vatCents).toBeNull();
    expect(credit.amountCents).toBe(-11_500);
    expect(credit.grossCents).toBe(-11_500);
  });

  it("adds VAT on top under exclusive pricing", () => {
    const invoice = { vatRateBasisPoints: 1500, vatCents: 5820 };
    const credit = splitAdditionalAmount(-10_000, invoice, {
      pricesIncludeVat: false,
    });
    expect(credit.amountCents).toBe(-10_000);
    expect(credit.vatCents).toBe(-1500);
    expect(credit.grossCents).toBe(-11_500);
  });
});

describe("presentation", () => {
  it("formats a rate from integers, never a float", () => {
    expect(formatVatRate(0)).toBe("0%");
    expect(formatVatRate(1500)).toBe("15%");
    expect(formatVatRate(1550)).toBe("15.5%");
    expect(formatVatRate(1525)).toBe("15.25%");
    expect(formatVatRate(1505)).toBe("15.05%");
    expect(formatVatRate(10_000)).toBe("100%");
  });

  it("labels the VAT line the way a tax invoice needs", () => {
    expect(vatLineLabel(1500)).toBe("VAT at 15%");
  });

  it("states the pricing position without claiming VAT that is not charged", () => {
    const notRegistered = pricingTermsSentence(NOT_REGISTERED);
    expect(notRegistered).toContain("not registered for VAT");
    expect(notRegistered).not.toContain("including VAT");

    expect(pricingTermsSentence(INCLUSIVE_15)).toContain("include VAT at 15%");
    expect(pricingTermsSentence(EXCLUSIVE_15)).toContain("exclude VAT");
    expect(pricingTermsSentence(EXCLUSIVE_15)).toContain("15%");

    // Unreadable setting: true whatever the company's VAT position is.
    const unknown = pricingTermsSentence(null);
    expect(unknown).toContain("Prices are in Rands");
    expect(unknown).not.toContain("not registered");
    expect(unknown).not.toContain("include VAT at");
  });

  it("uses no em dash in any customer-facing string", () => {
    const strings = [
      pricingTermsSentence(null),
      pricingTermsSentence(NOT_REGISTERED),
      pricingTermsSentence(INCLUSIVE_15),
      pricingTermsSentence(EXCLUSIVE_15),
      vatLineLabel(1500),
    ];
    // Escaped rather than literal: the repo keeps zero em dashes in its source,
    // and a test guarding that rule must not be the file that breaks it.
    for (const s of strings) expect(s).not.toContain("\u2014");
  });
});
