import { describe, it, expect } from "vitest";
import {
  AMOUNT_HELP,
  amountToInput,
  bundleItemsToInput,
  bundleLine,
  bundleTotals,
  optionalPriceCents,
  readQty,
  requirePriceCents,
  type BundleItemDraft,
  type BundleOption,
} from "@/app/admin/catalogue/pricing";
import { add, multiply, subtract } from "@/lib/money";

/**
 * Bundle arithmetic in integer cents.
 *
 * A bundle price is a shop-window figure: it reaches the home page, the PDF
 * catalogue and every quote that includes the bundle. What is pinned down here
 * is that no amount is read through a float, that an amount the app cannot
 * read stops the save instead of publishing R0.00, and that the margin the
 * admin is shown while composing is the margin the catalogue is given.
 */

// R388.00 sell, R300.00 cost: a real fibre line with a real margin on it.
const FIBRE: BundleOption = {
  id: "plan-1",
  name: "Telkom 20 Mbps",
  priceCents: 38800,
  costCents: 30000,
};
/** A product nobody has captured a wholesale cost for yet. */
const ROUTER: BundleOption = {
  id: "hw-1",
  name: "TP-Link Deco",
  priceCents: 129900,
  costCents: null,
};

function line(
  item: Partial<BundleItemDraft>,
  option: BundleOption | null = null,
  position = 1
) {
  return bundleLine(
    { itemType: "plan", qty: 1, ...item } as BundleItemDraft,
    option,
    position
  );
}

describe("readQty", () => {
  it("keeps quantities whole and positive", () => {
    expect(readQty("3")).toBe(3);
    expect(readQty("")).toBe(1);
    expect(readQty("0")).toBe(1);
    expect(readQty("-4")).toBe(1);
    expect(readQty("2.9")).toBe(2);
  });

  it("survives a cleared field instead of poisoning the totals", () => {
    // A cleared field used to reach `Math.max(1, Number("abc"))`, which is NaN,
    // and NaN × a price turned the whole margin readout into "RNaN".
    expect(readQty("abc")).toBe(1);
    expect(Number.isSafeInteger(readQty(Number.NaN))).toBe(true);
  });

  it("does not cap what the catalogue does not cap", () => {
    // Quote lines stop at 20 because the quote server does. A bundle of 50
    // SIMs is a real product, so nothing is silently clipped here.
    expect(readQty("50")).toBe(50);
  });
});

describe("requirePriceCents", () => {
  it("reads both South African and international grouping", () => {
    for (const typed of ["1234.56", "1 234,56", "R1 234,56", "1,234.56"]) {
      expect(requirePriceCents(typed, "bundle price")).toBe(123456);
    }
  });

  it("is exact where a float would not be", () => {
    // Math.round(12.34 * 100) happens to land on 1234, but 12.34 * 100 is
    // 1233.9999999999998 and the rounding is what was hiding that.
    expect(requirePriceCents("12.34", "bundle price")).toBe(1234);
    expect(requirePriceCents("0.07", "bundle price")).toBe(7);
  });

  it("refuses a blank price rather than publishing a free bundle", () => {
    // This is the failure the old builder shipped: an untouched price field
    // was `Math.round(0 * 100)`, and the bundle went live at R0.00.
    expect(() => requirePriceCents("", "bundle price")).toThrow(
      /Enter the bundle price/
    );
    expect(() => requirePriceCents(undefined, "bundle price")).toThrow(
      /Enter the bundle price/
    );
  });

  it("names the field when the text is not an amount", () => {
    expect(() => requirePriceCents("twelve", "price on line 2")).toThrow(
      /price on line 2/
    );
    expect(() => requirePriceCents("twelve", "price on line 2")).toThrow(
      AMOUNT_HELP
    );
  });

  it("refuses a negative price", () => {
    expect(() => requirePriceCents("-100", "bundle price")).toThrow(/positive/);
  });

  it("still allows a deliberate zero", () => {
    expect(requirePriceCents("0", "bundle price")).toBe(0);
  });

  it("round-trips through the text a money field holds", () => {
    for (const cents of [0, 7, 100, 1234, 125050, 99999999]) {
      expect(requirePriceCents(amountToInput(cents), "bundle price")).toBe(cents);
    }
  });
});

describe("optionalPriceCents", () => {
  it("keeps a blank line price as no price, not as zero", () => {
    // "Free delivery" with nothing in the price box is a real bundle line and
    // has always been stored with a null price.
    expect(optionalPriceCents("", "price on line 1")).toBeNull();
    expect(optionalPriceCents(undefined, "price on line 1")).toBeNull();
  });

  it("still refuses text it cannot read", () => {
    expect(() => optionalPriceCents("abc", "price on line 1")).toThrow(
      /price on line 1/
    );
  });
});

describe("bundleLine", () => {
  it("prices a catalogue line in cents", () => {
    const result = line({ itemType: "plan", planId: FIBRE.id, qty: 2 }, FIBRE);
    expect(result.priceCents).toBe(38800);
    expect(result.totalCents).toBe(77600);
    expect(result.costCents).toBe(30000);
    expect(result.problem).toBe("");
    expect(result.incomplete).toBe(false);
  });

  it("reports a cost of unknown, not zero, where none is captured", () => {
    expect(line({ itemType: "hardware", hardwareId: ROUTER.id }, ROUTER).costCents)
      .toBeNull();
  });

  it("reads a custom line's typed price without touching a float", () => {
    const result = line({
      itemType: "custom",
      customName: "Installation",
      customPrice: "1 250,50",
    });
    expect(result.priceCents).toBe(125050);
    expect(result.totalCents).toBe(125050);
  });

  it("names the line when a price cannot be read, and counts it as nothing", () => {
    const result = line(
      { itemType: "custom", customName: "Callout", customPrice: "R" },
      null,
      3
    );
    expect(result.problem).toContain("line 3");
    expect(result.problem).toContain(AMOUNT_HELP);
    expect(result.priceCents).toBe(0);
  });

  it("refuses a negative price instead of subtracting it from the bundle", () => {
    const result = line({
      itemType: "custom",
      customName: "Credit",
      customPrice: "-100",
    });
    expect(result.problem).toContain("positive");
    expect(result.priceCents).toBe(0);
  });

  it("treats a free custom line as finished, and a nameless one as not", () => {
    expect(line({ itemType: "custom", customName: "Free delivery" }).incomplete).toBe(
      false
    );
    expect(line({ itemType: "custom", customPrice: "100" }).incomplete).toBe(true);
    expect(line({ itemType: "plan" }, null).incomplete).toBe(true);
  });
});

describe("bundleTotals", () => {
  it("adds the components up and takes the margin off the bundle price", () => {
    const lines = [
      line({ itemType: "plan", planId: FIBRE.id, qty: 2 }, FIBRE),
      line({ itemType: "custom", customName: "Installation", customPrice: "500" }),
    ];
    const totals = bundleTotals(lines, "1 250,50");
    expect(totals.componentPriceCents).toBe(add(multiply(38800, 2), 50000));
    expect(totals.knownCostCents).toBe(multiply(30000, 2));
    expect(totals.priceCents).toBe(125050);
    expect(totals.marginCents).toBe(subtract(125050, 60000));
    expect(totals.problems).toEqual([]);
  });

  it("reports the margin as unknown when a wholesale cost is missing", () => {
    const totals = bundleTotals(
      [
        line({ itemType: "plan", planId: FIBRE.id }, FIBRE),
        line({ itemType: "hardware", hardwareId: ROUTER.id }, ROUTER),
      ],
      "1500"
    );
    expect(totals.costMissing).toBe(true);
    expect(totals.marginCents).toBeNull();
    // The component total is still known and still worth showing.
    expect(totals.componentPriceCents).toBe(add(38800, 129900));
  });

  it("blocks the save while the bundle price is empty", () => {
    const totals = bundleTotals(
      [line({ itemType: "plan", planId: FIBRE.id }, FIBRE)],
      ""
    );
    expect(totals.priceCents).toBeNull();
    expect(totals.marginCents).toBeNull();
    expect(totals.problems).toHaveLength(1);
  });

  it("collects every line the save would refuse", () => {
    const totals = bundleTotals(
      [
        line({ itemType: "custom", customName: "A", customPrice: "abc" }, null, 1),
        line({ itemType: "custom", customName: "B", customPrice: "1.2.3" }, null, 2),
      ],
      "1000"
    );
    expect(totals.problems).toHaveLength(2);
    expect(totals.problems[0]).toContain("line 1");
    expect(totals.problems[1]).toContain("line 2");
  });

  it("counts the lines that are not finished yet", () => {
    const totals = bundleTotals(
      [line({ itemType: "plan" }, null), line({ itemType: "custom" })],
      "1000"
    );
    expect(totals.incomplete).toBe(2);
  });
});

describe("bundleItemsToInput", () => {
  it("hands the server integer cents, never rands", () => {
    const [plan, custom] = bundleItemsToInput([
      { itemType: "plan", planId: "plan-1", qty: 2 },
      {
        itemType: "custom",
        customName: "Installation",
        customPrice: "R1 250,50",
        qty: 1,
      },
    ]);
    expect(plan.customPriceCents).toBeNull();
    expect(plan.planId).toBe("plan-1");
    expect(plan.qty).toBe(2);
    expect(custom.customPriceCents).toBe(125050);
    expect(custom.hardwareId).toBeNull();
  });

  it("refuses to save an amount it cannot read, naming the line", () => {
    expect(() =>
      bundleItemsToInput([
        { itemType: "plan", planId: "plan-1", qty: 1 },
        { itemType: "custom", customName: "Callout", customPrice: "twenty", qty: 1 },
      ])
    ).toThrow(/line 2/);
  });

  it("agrees with bundleLine on every figure it passes on", () => {
    // The admin is shown one number and the catalogue is given another only if
    // these two disagree, so they are checked against each other directly.
    const items: BundleItemDraft[] = [
      { itemType: "plan", planId: FIBRE.id, qty: 3 },
      { itemType: "custom", customName: "Install", customPrice: "1 250,50", qty: 1 },
    ];
    const input = bundleItemsToInput(items);
    const priced = [bundleLine(items[0], FIBRE, 1), bundleLine(items[1], null, 2)];
    expect(input[0].qty).toBe(priced[0].qty);
    expect(input[1].customPriceCents).toBe(priced[1].priceCents);
  });
});
