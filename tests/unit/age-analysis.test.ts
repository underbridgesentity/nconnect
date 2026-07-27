import { describe, it, expect } from "vitest";
import { bucketAgeAnalysis, type AgedInvoice } from "@/lib/domain/billing-engine";
import { add } from "@/lib/money";

/**
 * The debtors report, pure and database-free.
 *
 * A part payment leaves an invoice open on purpose, so the invoice total is
 * not the debt. Bucketing on the total put customers who had already paid most
 * of their bill at the top of the chase list and made the whole book look
 * bigger than it was. Every figure here is what is still owed.
 */

const TODAY = "2026-07-27";

function invoice(overrides: Partial<AgedInvoice> = {}): AgedInvoice {
  return {
    customerId: "cust-1",
    customerName: "Dlamini Trading",
    issueDate: TODAY,
    totalCents: 80000,
    paidCents: 0,
    ...overrides,
  };
}

describe("bucketAgeAnalysis", () => {
  it("counts what is owed, not what was invoiced", () => {
    const [bucket] = bucketAgeAnalysis(
      [invoice({ totalCents: 80000, paidCents: 60000 })],
      TODAY
    );
    expect(bucket.currentCents).toBe(20000);
    expect(bucket.totalCents).toBe(20000);
  });

  it("leaves out an invoice with nothing left outstanding", () => {
    // Settled by EFT but not yet flipped to paid: the customer owes nothing,
    // so they are not on the debtors report at all.
    expect(
      bucketAgeAnalysis([invoice({ totalCents: 80000, paidCents: 80000 })], TODAY)
    ).toEqual([]);
  });

  it("never lets an over-allocated invoice cancel another invoice's debt", () => {
    // R100 too much banked against one invoice is a data problem to look into,
    // never a credit that hides R100 of real debt somewhere else.
    const [bucket] = bucketAgeAnalysis(
      [
        invoice({ issueDate: "2026-07-20", totalCents: 80000, paidCents: 90000 }),
        invoice({ issueDate: "2026-07-20", totalCents: 50000, paidCents: 0 }),
      ],
      TODAY
    );
    expect(bucket.totalCents).toBe(50000);
  });

  it("puts each invoice in the bucket its age earns", () => {
    const [bucket] = bucketAgeAnalysis(
      [
        invoice({ issueDate: "2026-07-01" }), // 26 days
        invoice({ issueDate: "2026-06-20" }), // 37 days
        invoice({ issueDate: "2026-05-20" }), // 68 days
        invoice({ issueDate: "2026-01-20" }), // 188 days
      ],
      TODAY
    );
    expect(bucket.currentCents).toBe(80000);
    expect(bucket.d30Cents).toBe(80000);
    expect(bucket.d60Cents).toBe(80000);
    expect(bucket.d90Cents).toBe(80000);
    expect(bucket.totalCents).toBe(320000);
  });

  it("holds the bucket boundaries at 30, 60 and 90 days", () => {
    const on = (issueDate: string) => bucketAgeAnalysis([invoice({ issueDate })], TODAY)[0];
    expect(on("2026-06-28").currentCents).toBe(80000); // 29 days
    expect(on("2026-06-27").d30Cents).toBe(80000); // 30 days
    expect(on("2026-05-29").d30Cents).toBe(80000); // 59 days
    expect(on("2026-05-28").d60Cents).toBe(80000); // 60 days
    expect(on("2026-04-29").d60Cents).toBe(80000); // 89 days
    expect(on("2026-04-28").d90Cents).toBe(80000); // 90 days
  });

  it("adds a customer's invoices together and sorts the worst debt first", () => {
    const rows = bucketAgeAnalysis(
      [
        invoice({ customerId: "a", customerName: "Small", totalCents: 20000 }),
        invoice({ customerId: "b", customerName: "Big", totalCents: 90000 }),
        invoice({
          customerId: "b",
          customerName: "Big",
          issueDate: "2026-06-01",
          totalCents: 90000,
          paidCents: 30000,
        }),
      ],
      TODAY
    );
    expect(rows.map((r) => r.customerName)).toEqual(["Big", "Small"]);
    expect(rows[0].totalCents).toBe(add(90000, 60000));
    expect(rows[0].currentCents).toBe(90000);
    expect(rows[0].d30Cents).toBe(60000);
  });

  it("keeps the buckets adding up to the total, whatever the mix", () => {
    const rows = bucketAgeAnalysis(
      [
        invoice({ issueDate: "2026-07-26", totalCents: 12345, paidCents: 1 }),
        invoice({ issueDate: "2026-06-01", totalCents: 80000, paidCents: 79999 }),
        invoice({ issueDate: "2026-04-01", totalCents: 55555, paidCents: 0 }),
        invoice({ issueDate: "2026-01-01", totalCents: 99999, paidCents: 40000 }),
      ],
      TODAY
    );
    for (const row of rows) {
      expect(
        add(row.currentCents, row.d30Cents, row.d60Cents, row.d90Cents)
      ).toBe(row.totalCents);
    }
  });
});
