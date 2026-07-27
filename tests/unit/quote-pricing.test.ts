import { describe, it, expect } from "vitest";
import {
  AMOUNT_HELP,
  MAX_QTY,
  amountToInput,
  draftItemsToInput,
  priceLine,
  quoteTotals,
  readAmountCents,
  readQty,
  type Option,
  type QuoteDraftItem,
} from "@/app/sales/quotes/pricing";
import { add, multiply, percentOf, subtract } from "@/lib/money";

/**
 * Quote arithmetic in integer cents.
 *
 * The figures here end up on a customer's quote and in a rep's commission, so
 * what is being pinned down is that no amount is ever read through a float,
 * that an amount the app cannot read stops the save instead of being written
 * as zero, and that the builder's mirror of the §10.4 floor is the same rule
 * `lib/domain/quotes.ts` enforces on save.
 */

const RULES = { floorPercent: 10, noCostMaxPercent: 15 };

// R388.00 sell, R300.00 cost: an M1 fibre line with a real margin on it.
const FIBRE: Option = {
  id: "plan-1",
  name: "Telkom 20 Mbps",
  priceCents: 38800,
  costCents: 30000,
};
/** Bundles carry no cost price, so they fall under the no-cost discount cap. */
const BUNDLE: Option = {
  id: "bundle-1",
  name: "Work from home",
  priceCents: 100000,
  costCents: null,
};

function line(item: Partial<QuoteDraftItem>, option: Option | null = null) {
  return priceLine(
    { itemType: "plan", qty: 1, ...item } as QuoteDraftItem,
    option,
    RULES
  );
}

describe("readAmountCents", () => {
  it("reads both South African and international grouping", () => {
    // The app itself prints "R1 234,56", and reps paste from bank statements
    // and supplier quotes, so both conventions have to land on one figure.
    for (const typed of ["1234.56", "1 234,56", "R1 234,56", "1,234.56", "1.234,56"]) {
      expect(readAmountCents(typed)).toBe(123456);
    }
  });

  it("reads whole rands as whole rands, not as cents", () => {
    expect(readAmountCents("1250")).toBe(125000);
    expect(readAmountCents("R1 250")).toBe(125000);
  });

  it("is exact where a float would not be", () => {
    // 12.34 * 100 is 1233.9999999999998 in floating point. Reading the digits
    // instead of multiplying is the whole point.
    expect(readAmountCents("12.34")).toBe(1234);
    expect(readAmountCents("0.07")).toBe(7);
  });

  it("reads a group of three digits as thousands, both ways round", () => {
    // "1.005" is one thousand and five rands here, not R1.005. Three digits
    // after a separator is a thousands group in either convention, and a
    // third decimal is not a cent amount anyway.
    expect(readAmountCents("1.005")).toBe(100500);
    expect(readAmountCents("1,005")).toBe(100500);
  });

  it("treats nothing typed as nothing owed", () => {
    expect(readAmountCents("")).toBe(0);
    expect(readAmountCents("   ")).toBe(0);
    expect(readAmountCents(undefined)).toBe(0);
  });

  it("lets a rep type through a decimal separator", () => {
    // "12." is somebody half way through "12.50", not junk to shout about.
    expect(readAmountCents("12.")).toBe(1200);
    expect(readAmountCents("12,")).toBe(1200);
  });

  it("refuses text it cannot read rather than calling it zero", () => {
    for (const junk of ["abc", "1.2.3.4", "R", "12 rand"]) {
      expect(readAmountCents(junk)).toBeNull();
    }
  });

  it("round-trips through the text a money field holds", () => {
    for (const cents of [0, 7, 100, 1234, 125050, 99999999]) {
      expect(readAmountCents(amountToInput(cents))).toBe(cents);
    }
    expect(amountToInput(38800)).toBe("388.00");
    expect(amountToInput(7)).toBe("0.07");
  });
});

describe("readQty", () => {
  it("keeps quantities whole, positive and inside the server's cap", () => {
    expect(readQty("3")).toBe(3);
    expect(readQty("")).toBe(1);
    expect(readQty("0")).toBe(1);
    expect(readQty("-4")).toBe(1);
    expect(readQty("2.9")).toBe(2);
    expect(readQty(String(MAX_QTY + 5))).toBe(MAX_QTY);
    // A blank number input hands back "", which must not become NaN and take
    // the whole builder down when it reaches multiply().
    expect(Number.isSafeInteger(readQty(Number.NaN))).toBe(true);
  });
});

describe("priceLine", () => {
  it("prices a catalogue line and its margin in cents", () => {
    const result = line({ itemType: "plan", planId: FIBRE.id, qty: 2 }, FIBRE);
    expect(result.priceCents).toBe(38800);
    expect(result.totalCents).toBe(77600);
    expect(result.marginCents).toBe(17600);
    expect(result.problem).toBe("");
    expect(result.incomplete).toBe(false);
  });

  it("takes the discount off before multiplying by the quantity", () => {
    const result = line(
      { itemType: "plan", planId: FIBRE.id, discount: "50", qty: 3 },
      FIBRE
    );
    expect(result.discountCents).toBe(5000);
    expect(result.totalCents).toBe(multiply(subtract(38800, 5000), 3));
    expect(result.marginCents).toBe(multiply(subtract(subtract(38800, 5000), 30000), 3));
  });

  it("reports a margin of unknown, not zero, where no cost price is set", () => {
    const result = line({ itemType: "bundle", bundleId: BUNDLE.id }, BUNDLE);
    expect(result.marginCents).toBeNull();
  });

  it("gives a custom line no margin rather than crediting its whole price", () => {
    // quoteDetail skips custom lines when it adds margin up. The builder used
    // to count the full price, so the rep saw one figure before saving and a
    // smaller one straight after.
    const result = line({ itemType: "custom", customName: "Site survey", customPrice: "500" });
    expect(result.priceCents).toBe(50000);
    expect(result.marginCents).toBe(0);
  });

  it("holds the floor at cost plus the margin percentage", () => {
    const floor = add(30000, percentOf(30000, RULES.floorPercent));
    expect(floor).toBe(33000);
    // R58.00 off leaves R330.00, exactly the floor: allowed.
    const atFloor = line(
      { itemType: "plan", planId: FIBRE.id, discount: "58" },
      FIBRE
    );
    expect(atFloor.problem).toBe("");
    // One cent more is a breach.
    const below = line(
      { itemType: "plan", planId: FIBRE.id, discount: "58.01" },
      FIBRE
    );
    expect(below.problem).toContain("Below the floor");
  });

  it("caps the discount where there is no cost price to measure against", () => {
    const cap = percentOf(BUNDLE.priceCents, RULES.noCostMaxPercent);
    expect(cap).toBe(15000);
    expect(line({ itemType: "bundle", bundleId: BUNDLE.id, discount: "150" }, BUNDLE).problem).toBe("");
    expect(
      line({ itemType: "bundle", bundleId: BUNDLE.id, discount: "150.01" }, BUNDLE).problem
    ).toContain("the most you can take off");
  });

  it("refuses a discount bigger than the price", () => {
    expect(
      line({ itemType: "plan", planId: FIBRE.id, discount: "400" }, FIBRE).problem
    ).toBe("The discount is bigger than the price.");
  });

  it("says so when an amount cannot be read, and counts it as nothing", () => {
    const result = line({ itemType: "plan", planId: FIBRE.id, discount: "abc" }, FIBRE);
    expect(result.problem).toContain(AMOUNT_HELP);
    expect(result.discountCents).toBe(0);
  });

  it("refuses a negative amount instead of adding it to the total", () => {
    const result = line({ itemType: "plan", planId: FIBRE.id, discount: "-100" }, FIBRE);
    expect(result.problem).toBe("A discount is a positive amount.");
    expect(result.totalCents).toBe(38800);
  });

  it("counts an unfinished line as unfinished", () => {
    expect(line({ itemType: "plan" }, null).incomplete).toBe(true);
    expect(line({ itemType: "custom", customPrice: "100" }).incomplete).toBe(true);
    expect(line({ itemType: "custom", customName: "Callout" }).incomplete).toBe(true);
    expect(
      line({ itemType: "custom", customName: "Callout", customPrice: "0" }).incomplete
    ).toBe(true);
  });
});

describe("quoteTotals", () => {
  it("adds the lines up in cents and keeps the margin honest", () => {
    const lines = [
      line({ itemType: "plan", planId: FIBRE.id, qty: 2 }, FIBRE),
      line({ itemType: "custom", customName: "Install", customPrice: "1 250,50" }),
    ];
    const totals = quoteTotals(lines);
    expect(totals.totalCents).toBe(add(77600, 125050));
    // The custom line contributes nothing to margin and does not make it
    // unknown, exactly as quoteDetail reports it on the saved quote.
    expect(totals.marginCents).toBe(17600);
    expect(totals.problems).toBe(0);
    expect(totals.incomplete).toBe(0);
  });

  it("reports the margin as unknown when any cost price is missing", () => {
    const totals = quoteTotals([
      line({ itemType: "plan", planId: FIBRE.id }, FIBRE),
      line({ itemType: "bundle", bundleId: BUNDLE.id }, BUNDLE),
    ]);
    expect(totals.marginCents).toBeNull();
    expect(totals.totalCents).toBe(138800);
  });

  it("counts the lines that block a send", () => {
    const totals = quoteTotals([
      line({ itemType: "plan", planId: FIBRE.id, discount: "300" }, FIBRE),
      line({ itemType: "plan" }, null),
    ]);
    expect(totals.problems).toBe(1);
    expect(totals.incomplete).toBe(1);
  });
});

describe("draftItemsToInput", () => {
  it("hands the server integer cents, never rands", () => {
    const [item] = draftItemsToInput([
      {
        itemType: "custom",
        customName: "Site survey",
        customPrice: "R1 250,50",
        discount: "12,34",
        qty: 2,
      },
    ]);
    expect(item.customPriceCents).toBe(125050);
    expect(item.discountCents).toBe(1234);
    expect(item.qty).toBe(2);
    expect(item.planId).toBeNull();
  });

  it("leaves catalogue lines to the server to price", () => {
    const [item] = draftItemsToInput([
      { itemType: "plan", planId: "plan-1", qty: 1 },
    ]);
    expect(item.customPriceCents).toBeNull();
    expect(item.discountCents).toBe(0);
  });

  it("refuses to save an amount it cannot read, naming the line", () => {
    expect(() =>
      draftItemsToInput([
        { itemType: "plan", planId: "plan-1", qty: 1 },
        { itemType: "plan", planId: "plan-2", discount: "twenty", qty: 1 },
      ])
    ).toThrow(/line 2/);
  });

  it("refuses a negative amount, which the server would reject anyway", () => {
    expect(() =>
      draftItemsToInput([
        { itemType: "custom", customName: "Credit", customPrice: "-100", qty: 1 },
      ])
    ).toThrow(/positive/);
  });

  it("clamps a quantity to something the server will accept", () => {
    const [item] = draftItemsToInput([
      { itemType: "plan", planId: "plan-1", qty: 999 },
    ]);
    expect(item.qty).toBe(MAX_QTY);
  });

  it("agrees with priceLine on every figure it passes on", () => {
    // The rep is shown one number and the quote is built from another only if
    // these two disagree, so they are checked against each other directly.
    const items: QuoteDraftItem[] = [
      { itemType: "plan", planId: FIBRE.id, discount: "25,50", qty: 3 },
      { itemType: "custom", customName: "Install", customPrice: "1 250,50", qty: 1 },
    ];
    const input = draftItemsToInput(items);
    const priced = [priceLine(items[0], FIBRE, RULES), priceLine(items[1], null, RULES)];
    expect(input[0].discountCents).toBe(priced[0].discountCents);
    expect(input[0].qty).toBe(priced[0].qty);
    expect(input[1].customPriceCents).toBe(priced[1].priceCents);
  });
});
