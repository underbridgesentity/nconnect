/**
 * VAT, fully parameterised.
 *
 * Needd's VAT position is a settings question, not a code question. Whether
 * the company is registered, whether catalogue prices are quoted inclusive of
 * VAT, and the rate itself all live in the `vat` setting. Nothing here guesses
 * any of them: the seeded default is "not registered", and while that holds
 * the system prints no VAT number, computes no VAT, and claims none. Flipping
 * the setting is the whole change.
 *
 * Two invariants hold for every invoice this module touches:
 *
 *   invoice.subtotal_cents = sum(line.amount_cents)      (lines are VAT-exclusive)
 *   invoice.total_cents    = subtotal_cents + vat_cents
 *
 * `invoice_lines.amount_cents` is therefore always the amount excluding VAT.
 * Under `registered: false` there is no VAT, net equals gross, and that column
 * means exactly what it has always meant, so existing rows stay truthful and
 * existing sums stay correct.
 *
 * All arithmetic is integer. A float never touches a VAT amount: inclusive VAT
 * is `gross * rate / (10000 + rate)` and exclusive VAT is `net * rate / 10000`,
 * both evaluated as integer division rounded half-up, and the per-line amounts
 * are reconciled to the invoice figure by largest remainder so the split adds
 * up to the cent.
 */

import { z } from "zod";
import { add, type Cents } from "@/lib/money";

/** Settings key holding the VAT position. */
export const VAT_SETTING_KEY = "vat";

/** Basis points, never a float percent: 15% is 1500, 15.5% is 1550. */
export const vatSettingsSchema = z.object({
  /** Is the company registered for VAT? Nothing is charged while false. */
  registered: z.boolean(),
  /** VAT rate in basis points. 1500 = 15%. */
  rateBasisPoints: z.number().int().min(0).max(10_000),
  /** Are catalogue and plan prices quoted inclusive of VAT? */
  pricesIncludeVat: z.boolean(),
});

export type VatSettings = z.infer<typeof vatSettingsSchema>;

/**
 * The conservative position, and the one seeded: not registered, no rate.
 * Also the fallback whenever the stored setting is missing or malformed,
 * because charging a guessed rate is worse than charging none.
 */
export const DEFAULT_VAT: VatSettings = {
  registered: false,
  rateBasisPoints: 0,
  pricesIncludeVat: true,
};

/**
 * Read the stored setting into a shape the maths can trust. A malformed value
 * falls back to "not registered" and says so loudly rather than inventing a
 * rate, because a wrong rate on a tax invoice is a SARS problem, not a bug
 * report.
 */
export function parseVatSettings(raw: unknown): VatSettings {
  const parsed = vatSettingsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  if (raw !== null && raw !== undefined) {
    console.error(
      "vat: the stored `vat` setting is not usable, treating the company as not registered:",
      parsed.error.issues
    );
  }
  return DEFAULT_VAT;
}

/**
 * The rate to snapshot on an invoice being issued now, or null when the
 * company is not registered.
 *
 * Null is the signal that an invoice is not a tax invoice: no VAT number
 * prints on it and no split is shown. A registered company issuing a
 * zero-rated invoice still snapshots 0, which is a different and honest
 * statement: this document was issued by a VAT vendor.
 */
export function issueRateBasisPoints(settings: VatSettings): number | null {
  return settings.registered ? settings.rateBasisPoints : null;
}

function assertCents(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be integer cents, got ${value}`);
  }
}

function assertRate(rateBasisPoints: number): void {
  if (
    !Number.isSafeInteger(rateBasisPoints) ||
    rateBasisPoints < 0 ||
    rateBasisPoints > 10_000
  ) {
    throw new TypeError(
      `rateBasisPoints must be an integer between 0 and 10000, got ${rateBasisPoints}`
    );
  }
}

/**
 * Integer division rounded half-up on magnitude, symmetric about zero so a
 * credit line rounds the mirror of the charge it reverses.
 *
 * Written as `(2n + d) / 2d` floored rather than `Math.round(n / d)` so the
 * halfway case is decided by integers and never by a float that landed a
 * fraction below .5.
 */
function divRoundHalfUp(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    throw new RangeError(`denominator must be positive, got ${denominator}`);
  }
  const sign = numerator < 0 ? -1 : 1;
  const n = Math.abs(numerator);
  const scaled = 2 * n + denominator;
  if (!Number.isSafeInteger(scaled)) {
    throw new RangeError("VAT calculation exceeded safe integer precision");
  }
  const magnitude = Math.floor(scaled / (2 * denominator));
  // Never hand back negative zero. It is numerically equal to zero and so
  // slips through every check, but Intl formats it as "-R 0,00", which on a
  // customer's invoice reads as a credit that does not exist.
  return magnitude === 0 ? 0 : sign * magnitude;
}

/** The divisor for the pricing mode: inclusive prices carry VAT inside them. */
function denominatorFor(
  rateBasisPoints: number,
  pricesIncludeVat: boolean
): number {
  return pricesIncludeVat ? 10_000 + rateBasisPoints : 10_000;
}

/**
 * VAT contained inside a VAT-inclusive amount.
 * R388.00 at 15% is R50.61 of VAT inside it, leaving R337.39 net.
 */
export function vatFromGross(
  grossCents: Cents,
  rateBasisPoints: number
): Cents {
  assertCents(grossCents, "grossCents");
  assertRate(rateBasisPoints);
  if (rateBasisPoints === 0) return 0;
  return divRoundHalfUp(
    grossCents * rateBasisPoints,
    10_000 + rateBasisPoints
  );
}

/**
 * VAT added on top of a VAT-exclusive amount.
 * R337.39 at 15% attracts R50.61, giving R388.00 gross.
 */
export function vatFromNet(netCents: Cents, rateBasisPoints: number): Cents {
  assertCents(netCents, "netCents");
  assertRate(rateBasisPoints);
  if (rateBasisPoints === 0) return 0;
  return divRoundHalfUp(netCents * rateBasisPoints, 10_000);
}

/**
 * Spread an exact rational total across lines so the parts sum to `target`
 * with no lost or invented cent.
 *
 * Each line's exact share is `numerators[i] / denominator`. Truncating every
 * line toward zero leaves a shortfall of at most one cent per line; those
 * cents are handed out largest-remainder first, which is the fairest ordering
 * and, more importantly, a deterministic one. Signs are respected, so a credit
 * line on a plan change gives a cent back rather than taking one.
 */
function allocateByLargestRemainder(
  numerators: number[],
  denominator: number,
  target: Cents
): Cents[] {
  if (numerators.length === 0) {
    if (target !== 0) {
      throw new RangeError(`cannot allocate ${target} cents across zero lines`);
    }
    return [];
  }

  const shares = numerators.map((n) => Math.trunc(n / denominator));
  const remainders = numerators.map(
    (n, i) => n - shares[i] * denominator
  );

  let leftover = target - shares.reduce((sum, s) => sum + s, 0);
  if (leftover === 0) return shares;

  const order = numerators
    .map((_, i) => i)
    .sort((a, b) => {
      const diff = Math.abs(remainders[b]) - Math.abs(remainders[a]);
      return diff !== 0 ? diff : a - b;
    });

  const step = leftover > 0 ? 1 : -1;
  let cursor = 0;
  while (leftover !== 0) {
    shares[order[cursor % order.length]] += step;
    leftover -= step;
    cursor += 1;
  }
  return shares;
}

/** One line of the split. `amountCents` is always the VAT-exclusive amount. */
export type VatLineSplit = {
  /** Store this in `invoice_lines.amount_cents`. Excludes VAT. */
  amountCents: Cents;
  /** Store this in `invoice_lines.vat_cents`. Null when not a VAT invoice. */
  vatCents: Cents | null;
  /** Store this in `invoice_lines.vat_rate_basis_points`. */
  vatRateBasisPoints: number | null;
  /** Convenience for display: what this line costs including VAT. */
  grossCents: Cents;
};

export type InvoiceVatSplit = {
  /** Store in `invoices.subtotal_cents`. Sum of the line amounts, excl. VAT. */
  subtotalCents: Cents;
  /** Store in `invoices.vat_cents`. Null when not a VAT invoice. */
  vatCents: Cents | null;
  /** Store in `invoices.total_cents`. Subtotal plus VAT. */
  totalCents: Cents;
  /** Store in `invoices.vat_rate_basis_points`. Snapshotted at issue time. */
  vatRateBasisPoints: number | null;
  lines: VatLineSplit[];
};

/**
 * Split a set of line amounts into net, VAT and gross at issue time.
 *
 * `amountsAsPriced` are the amounts the way the catalogue quotes them: gross
 * when `pricesIncludeVat`, net when not. Credits are negative and are handled
 * as the mirror of a charge. The caller stores each returned `amountCents` in
 * the line, so `invoice_lines.amount_cents` ends up VAT-exclusive whichever
 * way prices are quoted, and the invoice always reconciles as
 * `subtotal + vat = total`.
 *
 * While the company is not registered this returns nulls for every VAT field
 * and leaves the amounts exactly as they were handed in. Callers can therefore
 * apply it unconditionally.
 */
export function splitInvoiceVat(
  amountsAsPriced: Cents[],
  settings: VatSettings
): InvoiceVatSplit {
  amountsAsPriced.forEach((amount, i) =>
    assertCents(amount, `amountsAsPriced[${i}]`)
  );

  const rateBasisPoints = issueRateBasisPoints(settings);

  // Not registered: no VAT exists to split, and nothing about the invoice
  // changes. This is the shipped default and the honest one.
  if (rateBasisPoints === null) {
    const subtotalCents = add(...amountsAsPriced);
    return {
      subtotalCents,
      vatCents: null,
      totalCents: subtotalCents,
      vatRateBasisPoints: null,
      lines: amountsAsPriced.map((amountCents) => ({
        amountCents,
        vatCents: null,
        vatRateBasisPoints: null,
        grossCents: amountCents,
      })),
    };
  }

  const denominator = denominatorFor(
    rateBasisPoints,
    settings.pricesIncludeVat
  );
  const pricedTotal = add(...amountsAsPriced);

  // Round once, on the invoice figure. The lines are then reconciled to it.
  const vatCents =
    rateBasisPoints === 0
      ? 0
      : divRoundHalfUp(pricedTotal * rateBasisPoints, denominator);

  const lineVat =
    rateBasisPoints === 0
      ? amountsAsPriced.map(() => 0)
      : allocateByLargestRemainder(
          amountsAsPriced.map((amount) => amount * rateBasisPoints),
          denominator,
          vatCents
        );

  const lines: VatLineSplit[] = amountsAsPriced.map((priced, i) => {
    const lineVatCents = lineVat[i];
    const amountCents = settings.pricesIncludeVat
      ? priced - lineVatCents
      : priced;
    return {
      amountCents,
      vatCents: lineVatCents,
      vatRateBasisPoints: rateBasisPoints,
      grossCents: amountCents + lineVatCents,
    };
  });

  const subtotalCents = settings.pricesIncludeVat
    ? pricedTotal - vatCents
    : pricedTotal;

  return {
    subtotalCents,
    vatCents,
    totalCents: subtotalCents + vatCents,
    vatRateBasisPoints: rateBasisPoints,
    lines,
  };
}

/**
 * The VAT on a single further amount added to an invoice that already carries
 * a snapshotted rate, such as a goodwill credit posted after issue.
 *
 * The rate comes from the invoice, never from the current setting, so a rate
 * change between issue and adjustment cannot rewrite the document's history.
 * Returns nulls when the invoice is not a tax invoice.
 */
export function splitAdditionalAmount(
  amountAsPriced: Cents,
  invoice: { vatRateBasisPoints: number | null },
  settings: Pick<VatSettings, "pricesIncludeVat">
): { amountCents: Cents; vatCents: Cents | null; grossCents: Cents } {
  assertCents(amountAsPriced, "amountAsPriced");
  const rate = invoice.vatRateBasisPoints;
  if (rate === null) {
    return {
      amountCents: amountAsPriced,
      vatCents: null,
      grossCents: amountAsPriced,
    };
  }
  const vatCents = settings.pricesIncludeVat
    ? vatFromGross(amountAsPriced, rate)
    : vatFromNet(amountAsPriced, rate);
  const amountCents = settings.pricesIncludeVat
    ? amountAsPriced - vatCents
    : amountAsPriced;
  return { amountCents, vatCents, grossCents: amountCents + vatCents };
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/** The VAT-bearing fields every surface reads off an invoice row. */
export type VatSnapshot = {
  vatRateBasisPoints: number | null;
  vatCents: number | null;
};

/**
 * Is this a tax invoice?
 *
 * The snapshotted rate is the test, not the amount. An invoice issued before
 * registration has no rate, is not a tax invoice, and must not print a VAT
 * number. An invoice issued by a registered vendor has a rate even if the VAT
 * on it happens to be zero.
 */
export function isTaxInvoice(invoice: VatSnapshot): boolean {
  return invoice.vatRateBasisPoints !== null;
}

/**
 * Should the VAT registration number appear on this document? Only when the
 * document itself carries a rate. Printing a VAT number beside a total with no
 * breakdown is worse than printing neither.
 */
export function showsVatNumber(invoice: VatSnapshot): boolean {
  return isTaxInvoice(invoice);
}

/**
 * Basis points as a percentage for display: 1500 -> "15%", 1550 -> "15.5%".
 * Built from integers so no rate can render as "14.999999%".
 */
export function formatVatRate(rateBasisPoints: number): string {
  assertRate(rateBasisPoints);
  const whole = Math.trunc(rateBasisPoints / 100);
  const fraction = rateBasisPoints % 100;
  if (fraction === 0) return `${whole}%`;
  const decimals = fraction % 10 === 0 ? String(fraction / 10) : String(fraction).padStart(2, "0");
  return `${whole}.${decimals}%`;
}

/** "VAT at 15%", the label a South African tax invoice needs beside the amount. */
export function vatLineLabel(rateBasisPoints: number): string {
  return `VAT at ${formatVatRate(rateBasisPoints)}`;
}

/**
 * The wording the terms page uses for pricing. Every branch is a statement we
 * can stand behind: while the company is not registered it says so plainly
 * rather than repeating the old claim that prices include VAT.
 *
 * `null` means the setting could not be read. That branch says only what is
 * true under every possible setting, so an unreachable database can never turn
 * a legal page into a false statement.
 */
export function pricingTermsSentence(settings: VatSettings | null): string {
  if (settings === null) {
    return "Prices are in Rands. Your invoice is the authority on the exact amount due and shows any VAT separately, at the rate applying on its issue date.";
  }
  if (!settings.registered) {
    return "Prices are in Rands. We are not registered for VAT, so no VAT is charged and our invoices are not tax invoices.";
  }
  const rate = formatVatRate(settings.rateBasisPoints);
  return settings.pricesIncludeVat
    ? `Prices are in Rands and include VAT at ${rate}. Every invoice shows the amount excluding VAT, the VAT and the total.`
    : `Prices are in Rands and exclude VAT, which is added at ${rate} on your invoice. Every invoice shows the amount excluding VAT, the VAT and the total.`;
}
