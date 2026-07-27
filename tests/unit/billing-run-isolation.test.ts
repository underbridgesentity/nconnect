import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The nightly billing run must not be an all-or-nothing job.
 *
 * Before this, `runDunning` walked every open invoice in a bare loop: the
 * first row that threw took the whole sweep down with it, so every customer
 * behind that row went un-chased and the cancellation sweep never ran at all.
 * These tests drive the sweeps against a scripted fake database, so they need
 * no Postgres, and assert the two things that matter: the run keeps going
 * past a bad row, and it reports how many rows it could not do.
 */

// -------------------------------------------------------- scripted fake db

type Scripted = { result?: unknown; error?: Error };

let selectScript: Scripted[] = [];
let selectCalls = 0;

/** Anything drizzle chains onto a query, ending in an awaitable. */
function thenable(entry: Scripted) {
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  for (const key of [
    "from",
    "where",
    "limit",
    "innerJoin",
    "leftJoin",
    "orderBy",
    "groupBy",
    "for",
    "set",
    "values",
    "returning",
  ]) {
    chain[key] = passthrough;
  }
  chain.then = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown
  ) =>
    (entry.error
      ? Promise.reject(entry.error)
      : Promise.resolve(entry.result ?? [])
    ).then(resolve, reject);
  return chain;
}

function nextSelect(): Scripted {
  const entry = selectScript[selectCalls];
  selectCalls++;
  if (!entry) {
    return { error: new Error(`unscripted select #${selectCalls}`) };
  }
  return entry;
}

const fakeDb = {
  select: () => thenable(nextSelect()),
  update: () => thenable({ result: [] }),
  insert: () => thenable({ result: [] }),
  delete: () => thenable({ result: [] }),
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeDb),
};

vi.mock("@/lib/db/client", () => ({
  db: fakeDb,
  schema: {},
}));

// Settings, notifications and the gateway all reach for the network or the
// database; none of them is what these tests are about.
vi.mock("@/lib/domain/settings", () => ({
  getSettingOr: async <T>(_key: string, fallback: T) => fallback,
}));
vi.mock("@/lib/notify", () => ({ notify: async () => {} }));
vi.mock("@/lib/payfast", () => ({
  chargeToken: async () => ({ ok: false, detail: "not used" }),
}));
vi.mock("@/lib/pdf/invoice", () => ({
  renderInvoicePdf: async () => Buffer.from(""),
}));
vi.mock("@/lib/domain/events", () => ({
  emitDomainEvent: async () => "event-id",
  forwardDomainEvent: async () => {},
}));
vi.mock("@/lib/domain/audit", () => ({ writeAudit: async () => {} }));

const finalizeCancellation = vi.fn(async (_serviceId: string) => {});
vi.mock("@/lib/domain/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/domain/services")>();
  return {
    ...actual,
    suspendService: async () => {},
    reactivateService: async () => {},
    finalizeCancellation: (serviceId: string) =>
      finalizeCancellation(serviceId),
  };
});

const engine = await import("@/lib/domain/billing-engine");

// One open invoice, issued today, so dunning is on charge-attempt day 0.
function invoiceRow(id: string) {
  return {
    id,
    number: `INV-${id}`,
    customerId: `cust-${id}`,
    serviceId: null,
    issueDate: "2026-07-10",
    status: "open" as const,
    totalCents: 75400,
  };
}

beforeEach(() => {
  selectScript = [];
  selectCalls = 0;
  finalizeCancellation.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("runDunning isolation", () => {
  it("keeps going after an invoice throws, and counts the failure", async () => {
    selectScript = [
      // The open-invoice sweep.
      { result: [invoiceRow("a"), invoiceRow("b"), invoiceRow("c")] },
      // Invoice a: the collection-attempt lookup blows up.
      { error: new Error("connection terminated unexpectedly") },
      // Invoice b: an attempt already exists for this slot, then the re-read.
      { result: [{ n: 1 }] },
      { result: [invoiceRow("b")] },
      // Invoice c: same, and it must be reached despite a failing.
      { result: [{ n: 1 }] },
      { result: [invoiceRow("c")] },
    ];

    const result = await engine.runDunning("2026-07-10");

    expect(result.processed).toBe(3);
    expect(result.failed).toBe(1);
    // Every scripted query ran, which is what proves c was reached.
    expect(selectCalls).toBe(6);
  });

  it("reports a clean run honestly", async () => {
    selectScript = [
      { result: [invoiceRow("a"), invoiceRow("b")] },
      { result: [{ n: 1 }] },
      { result: [invoiceRow("a")] },
      { result: [{ n: 1 }] },
      { result: [invoiceRow("b")] },
    ];

    const result = await engine.runDunning("2026-07-10");

    expect(result.processed).toBe(2);
    expect(result.failed).toBe(0);
  });

  it("survives every invoice failing rather than throwing at the caller", async () => {
    selectScript = [
      { result: [invoiceRow("a"), invoiceRow("b")] },
      { error: new Error("deadlock detected") },
      { error: new Error("deadlock detected") },
    ];

    const result = await engine.runDunning("2026-07-10");

    expect(result.processed).toBe(2);
    expect(result.failed).toBe(2);
  });

  it("skips invoices dated in the future without counting them", async () => {
    selectScript = [{ result: [invoiceRow("a")] }];

    // Issued 2026-07-10, run for 2026-07-09: nothing is due yet.
    const result = await engine.runDunning("2026-07-09");

    expect(result.processed).toBe(0);
    expect(result.failed).toBe(0);
  });
});

describe("runCancellationSweep isolation", () => {
  it("finalizes the services it can and reports the true count", async () => {
    selectScript = [{ result: [{ id: "s1" }, { id: "s2" }, { id: "s3" }] }];
    finalizeCancellation.mockImplementation(async (serviceId: string) => {
      if (serviceId === "s2") throw new Error("provider connector timed out");
    });

    const finalized = await engine.runCancellationSweep("2026-07-10");

    // Three were due, one failed, and the run says two rather than three.
    expect(finalized).toBe(2);
    expect(finalizeCancellation).toHaveBeenCalledTimes(3);
  });
});

describe("runInvoiceGeneration isolation", () => {
  it("bills the services it can when one of them throws", async () => {
    selectScript = [
      // Services due for an anniversary invoice.
      { result: [{ id: "svc-a" }, { id: "svc-b" }] },
      // svc-a: the row lock read fails.
      { error: new Error("could not obtain lock on row") },
      // svc-b: locked row comes back already billed past today, so it is a
      // no-op rather than a second invoice for the month.
      {
        result: [
          {
            id: "svc-b",
            status: "active",
            nextInvoiceDate: "2026-08-10",
            billingAnchorDay: 10,
            planId: "plan-1",
            customerId: "cust-b",
          },
        ],
      },
    ];

    const created = await engine.runInvoiceGeneration("2026-07-10");

    expect(created).toEqual([]);
    // Both services were attempted; the first failing did not end the run.
    expect(selectCalls).toBe(3);
  });
});
