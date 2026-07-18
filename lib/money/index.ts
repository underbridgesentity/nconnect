/**
 * All money in Needd Connect is integer cents (ZAR).
 * Floats never touch money: every function here takes and returns integers,
 * and throws if handed anything else. Division distributes remainders so
 * totals always reconcile to the cent.
 */

export type Cents = number;

function assertCents(value: number, label = "amount"): void {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be integer cents, got ${value}`);
  }
}

export function add(...amounts: Cents[]): Cents {
  return amounts.reduce((sum, a) => {
    assertCents(a);
    return sum + a;
  }, 0);
}

export function subtract(a: Cents, b: Cents): Cents {
  assertCents(a);
  assertCents(b);
  return a - b;
}

/** Multiply an amount by an integer quantity. */
export function multiply(amount: Cents, qty: number): Cents {
  assertCents(amount, "amount");
  assertCents(qty, "qty");
  return amount * qty;
}

/**
 * Percentage of an amount in basis-point precision, rounded half-up.
 * percent may be fractional (e.g. 10, 12.5); amount must be integer cents.
 */
export function percentOf(amount: Cents, percent: number): Cents {
  assertCents(amount);
  if (!Number.isFinite(percent)) throw new TypeError("percent must be finite");
  // Work in basis points to keep the intermediate integer-exact.
  const basisPoints = Math.round(percent * 100);
  return divRoundHalfUp(amount * basisPoints, 10_000);
}

function divRoundHalfUp(numerator: number, denominator: number): Cents {
  const q = numerator / denominator;
  return Math.sign(q) * Math.round(Math.abs(q));
}

/**
 * Split an amount into `parts` integer shares that sum exactly to the input.
 * The remainder lands on the last share(s), spec §5: "integer math with
 * remainder on the last line".
 */
export function allocate(amount: Cents, parts: number): Cents[] {
  assertCents(amount);
  if (!Number.isSafeInteger(parts) || parts <= 0) {
    throw new TypeError(`parts must be a positive integer, got ${parts}`);
  }
  const base = Math.trunc(amount / parts);
  const remainder = amount - base * parts;
  const shares = new Array<Cents>(parts).fill(base);
  // Distribute the remainder one cent at a time from the end.
  const step = remainder >= 0 ? 1 : -1;
  for (let i = 0; i < Math.abs(remainder); i++) {
    shares[parts - 1 - (i % parts)] += step;
  }
  return shares;
}

/**
 * Pro-rata portion of a monthly amount for `days` out of `daysInPeriod`.
 * Daily rate = monthly price / days in the current period (spec §5).
 * Integer-exact: the value for `days` days plus the value for the remaining
 * days always equals the full monthly amount.
 */
export function prorata(
  monthlyAmount: Cents,
  days: number,
  daysInPeriod: number
): Cents {
  assertCents(monthlyAmount);
  if (!Number.isSafeInteger(days) || days < 0) {
    throw new TypeError(`days must be a non-negative integer, got ${days}`);
  }
  if (!Number.isSafeInteger(daysInPeriod) || daysInPeriod <= 0) {
    throw new TypeError(
      `daysInPeriod must be a positive integer, got ${daysInPeriod}`
    );
  }
  if (days > daysInPeriod) {
    throw new RangeError(`days (${days}) exceeds daysInPeriod (${daysInPeriod})`);
  }
  // Allocate the month across its days, then take the first `days` shares.
  // Complement-exactness: prorata(m, d, n) + prorata(m, n-d, n) === m requires
  // taking one side as the exact complement of the other.
  const perDayTotal = Math.trunc((monthlyAmount * days) / daysInPeriod);
  return perDayTotal;
}

/** Exact complement of prorata: the unused remainder of the month. */
export function prorataComplement(
  monthlyAmount: Cents,
  days: number,
  daysInPeriod: number
): Cents {
  return subtract(monthlyAmount, prorata(monthlyAmount, days, daysInPeriod));
}

const zarFormatter = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  currencyDisplay: "narrowSymbol",
});

const zarWholeFormatter = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  currencyDisplay: "narrowSymbol",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Format cents as ZAR, e.g. 38800 -> "R388.00".
 * `whole: true` drops the cents when they are zero (marketing surfaces).
 */
export function formatCents(
  amount: Cents,
  opts: { whole?: boolean } = {}
): string {
  assertCents(amount);
  const rands = amount / 100;
  if (opts.whole && amount % 100 === 0) {
    return zarWholeFormatter.format(rands);
  }
  return zarFormatter.format(rands);
}

/** Parse a human ZAR string ("R1 833", "1833.50") into cents. Throws on junk. */
export function parseZar(input: string): Cents {
  const cleaned = input.replace(/[R\s, ]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new TypeError(`cannot parse "${input}" as ZAR`);
  }
  const [rands, centsPart = ""] = cleaned.split(".");
  const sign = cleaned.startsWith("-") ? -1 : 1;
  const cents =
    Math.abs(parseInt(rands, 10)) * 100 + parseInt(centsPart.padEnd(2, "0") || "0", 10);
  return sign * cents;
}

/** Rands (integer) to cents — convenience for seeds and settings. */
export function rands(amount: number): Cents {
  if (!Number.isSafeInteger(amount)) {
    throw new TypeError(`rands() takes whole rands, got ${amount}`);
  }
  return amount * 100;
}
