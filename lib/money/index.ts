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
  const magnitude = Math.round(Math.abs(q));
  // Never return negative zero. It compares equal to zero, so it slips through
  // every guard, but Intl formats it as "-R 0,00": a small negative percentage
  // of a small amount, such as a rounding credit on a cent, would print on a
  // customer's invoice as a credit that does not exist.
  return magnitude === 0 ? 0 : Math.sign(q) * magnitude;
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

/**
 * Parse a human ZAR string into cents. Throws on junk.
 *
 * Both South African and international grouping are accepted, because the two
 * conventions disagree about which separator means what, and operators paste
 * amounts from bank statements, invoices and this app's own screens:
 *
 *   "R1 833"   "1833.50"   "R1 234,56"   "1.234,56"   "1,234.56"
 *
 * Whichever separator appears last, with one or two digits after it, is the
 * decimal separator; every other separator is a thousands mark. This matters:
 * formatCents renders en-ZA, so the app itself prints "R1 234,56", and naively
 * stripping commas read that back as R123 456,00, a hundredfold error on a
 * real payment. Accounting exports also write the minus sign after the number.
 */
export function parseZar(input: string): Cents {
  let value = input.trim();
  let negative = false;
  if (value.startsWith("-")) {
    negative = true;
    value = value.slice(1);
  }
  if (value.endsWith("-")) {
    negative = true;
    value = value.slice(0, -1);
  }
  // Strip the currency mark and every kind of space, including the non-breaking
  // and narrow non-breaking spaces Intl uses as the en-ZA thousands separator.
  value = value.replace(/^(ZAR|R)\s*/i, "").replace(/[\s\u00a0\u202f]/g, "");

  // Reject anything that is not sanely grouped, so "1.2.3.4" is an error rather
  // than being quietly read as R123.40.
  const grouped = /^\d{1,3}([.,]\d{3})*([.,]\d{1,2})?$/;
  const plain = /^\d+([.,]\d{1,2})?$/;
  if (!grouped.test(value) && !plain.test(value)) {
    throw new TypeError(`cannot parse "${input}" as ZAR`);
  }

  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");
  let decimalAt = -1;
  if (lastComma >= 0 && lastDot >= 0) {
    decimalAt = Math.max(lastComma, lastDot);
  } else if (lastComma >= 0) {
    decimalAt = /,\d{1,2}$/.test(value) ? lastComma : -1;
  } else if (lastDot >= 0) {
    decimalAt = /\.\d{1,2}$/.test(value) ? lastDot : -1;
  }

  const whole =
    (decimalAt >= 0 ? value.slice(0, decimalAt) : value).replace(/[.,]/g, "") ||
    "0";
  const fraction = decimalAt >= 0 ? value.slice(decimalAt + 1) : "";
  const cents =
    parseInt(whole, 10) * 100 + parseInt(fraction.padEnd(2, "0") || "0", 10);
  return negative ? -cents : cents;
}

/** Rands (integer) to cents, convenience for seeds and settings. */
export function rands(amount: number): Cents {
  if (!Number.isSafeInteger(amount)) {
    throw new TypeError(`rands() takes whole rands, got ${amount}`);
  }
  return amount * 100;
}
