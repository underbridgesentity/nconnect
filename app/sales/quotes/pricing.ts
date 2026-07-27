import {
  add,
  formatCents,
  multiply,
  parseZar,
  percentOf,
  subtract,
  type Cents,
} from "@/lib/money";

/**
 * Quote arithmetic, shared by the builder and the save action.
 *
 * Every figure a rep sees and every figure the server stores is computed here,
 * in integer cents through `lib/money`, so the total on screen and the total
 * written to the quote are the same number. The §10.4 floor is the rule
 * `lib/domain/quotes.ts` enforces, mirrored so a breach shows as the rep types
 * rather than arriving as a refusal after Send. The server stays the
 * authority: nothing here decides anything, it only says what will happen.
 *
 * Amounts travel as the text the rep typed, never as rands in a float.
 * `parseZar` reads that text with integer maths, so "1 250,50" pasted from a
 * supplier quote and "1250.50" typed by hand are both 125050 cents, and text
 * it cannot read is reported rather than quietly read as zero.
 */

export interface QuoteDraftItem {
  itemType: "plan" | "hardware" | "bundle" | "custom";
  planId?: string;
  hardwareId?: string;
  bundleId?: string;
  customName?: string;
  /** What the rep typed for a custom line's price, verbatim. */
  customPrice?: string;
  /** What the rep typed as this line's discount, verbatim. */
  discount?: string;
  qty: number;
}

/** A catalogue entry as the picker offers it. */
export interface Option {
  id: string;
  name: string;
  /** "Telkom · 20 Mbps · Uncapped", shown under the name in the picker. */
  detail?: string | null;
  priceCents: Cents;
  costCents: Cents | null;
}

/** The two §10.4 settings, passed in so the mirror cannot drift from them. */
export interface QuoteRules {
  floorPercent: number;
  noCostMaxPercent: number;
}

export const AMOUNT_HELP = "Amounts look like 1250 or 1 250,50.";

/** The server caps a line at 20, so the builder caps it in the same place. */
export const MAX_QTY = 20;

/**
 * Read a typed amount into integer cents. Blank means nothing was typed, which
 * is zero. Anything that is not an amount comes back as null so the caller can
 * say so, because reading it as zero would silently drop a discount or price
 * the rep believes they entered.
 */
export function readAmountCents(typed: string | undefined | null): Cents | null {
  // A trailing separator is somebody mid-way through typing "12.50", not junk.
  const text = (typed ?? "").trim().replace(/[.,]$/, "");
  if (!text) return 0;
  try {
    return parseZar(text);
  } catch {
    return null;
  }
}

/** Cents back into the plain text that a money field and `parseZar` agree on. */
export function amountToInput(cents: Cents): string {
  // String maths, so no division ever touches the amount.
  const digits = String(Math.abs(cents)).padStart(3, "0");
  const sign = cents < 0 ? "-" : "";
  return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/**
 * Quantities are counts, not money: whole, at least one, and never above the
 * server's cap, so a rep cannot build a quote that will be refused on save.
 */
export function readQty(typed: string | number): number {
  const parsed =
    typeof typed === "number" ? Math.trunc(typed) : Number.parseInt(typed, 10);
  if (!Number.isSafeInteger(parsed)) return 1;
  return Math.min(MAX_QTY, Math.max(1, parsed));
}

export interface QuoteLine {
  priceCents: Cents;
  discountCents: Cents;
  qty: number;
  totalCents: Cents;
  /**
   * Margin on this line. Zero on a custom line, which carries no cost by
   * nature, and null where a catalogue line has no cost price captured, so
   * "not known" is never displayed as "nothing". Matches `quoteDetail`, which
   * the rep sees on the saved quote a moment later.
   */
  marginCents: Cents | null;
  /** Empty when the line is fine, a sentence the rep can act on otherwise. */
  problem: string;
  /** Still missing a product, a name or a price. */
  incomplete: boolean;
}

function lineProblem(input: {
  typedPrice: Cents | null;
  typedDiscount: Cents | null;
  priceCents: Cents;
  discountCents: Cents;
  costCents: Cents | null;
  rules: QuoteRules;
}): string {
  const { typedPrice, typedDiscount, priceCents, discountCents, costCents } =
    input;
  if (typedPrice === null) return `That price is not an amount. ${AMOUNT_HELP}`;
  if (typedDiscount === null) {
    return `That discount is not an amount. ${AMOUNT_HELP}`;
  }
  if (priceCents < 0) return "A price is a positive amount.";
  if (discountCents < 0) return "A discount is a positive amount.";
  if (discountCents === 0) return "";
  if (discountCents > priceCents) return "The discount is bigger than the price.";

  if (costCents != null) {
    const floor = add(costCents, percentOf(costCents, input.rules.floorPercent));
    if (subtract(priceCents, discountCents) < floor) {
      return `Below the floor: this line may not go under ${formatCents(floor)} (cost plus ${input.rules.floorPercent}%).`;
    }
    return "";
  }
  const maxDiscount = percentOf(priceCents, input.rules.noCostMaxPercent);
  if (discountCents > maxDiscount) {
    return `No cost price is set, so the most you can take off is ${formatCents(maxDiscount)} (${input.rules.noCostMaxPercent}%).`;
  }
  return "";
}

/** Price one draft line against the catalogue option it points at. */
export function priceLine(
  item: QuoteDraftItem,
  option: Option | null,
  rules: QuoteRules
): QuoteLine {
  const custom = item.itemType === "custom";
  // What the rep typed: null when it is not an amount, possibly negative.
  const typedPrice = custom ? readAmountCents(item.customPrice) : 0;
  const typedDiscount = readAmountCents(item.discount);
  const costCents = custom ? null : (option?.costCents ?? null);
  const qty = readQty(item.qty);

  // The figures the totals are built from. An amount that is unreadable or
  // negative counts as nothing here and is reported through `problem`, which
  // blocks the save, so no such line ever reaches a customer's quote.
  const priceCents = custom
    ? Math.max(typedPrice ?? 0, 0)
    : (option?.priceCents ?? 0);
  const discountCents = Math.max(typedDiscount ?? 0, 0);

  const net = subtract(priceCents, discountCents);
  const marginCents = custom
    ? 0
    : costCents == null
      ? null
      : multiply(subtract(net, costCents), qty);

  return {
    priceCents,
    discountCents,
    qty,
    totalCents: multiply(net, qty),
    marginCents,
    problem: lineProblem({
      typedPrice,
      typedDiscount,
      priceCents: custom ? (typedPrice ?? 0) : priceCents,
      discountCents: typedDiscount ?? 0,
      costCents,
      rules,
    }),
    incomplete: custom
      ? !item.customName?.trim() || typedPrice == null || typedPrice <= 0
      : option == null,
  };
}

export interface QuoteTotals {
  totalCents: Cents;
  /** null when any catalogue line has no cost price: the margin is unknown. */
  marginCents: Cents | null;
  problems: number;
  incomplete: number;
}

export function quoteTotals(lines: QuoteLine[]): QuoteTotals {
  let totalCents = 0;
  let marginCents = 0;
  let marginKnown = true;
  let problems = 0;
  let incomplete = 0;
  for (const line of lines) {
    totalCents = add(totalCents, line.totalCents);
    if (line.marginCents == null) marginKnown = false;
    else marginCents = add(marginCents, line.marginCents);
    if (line.problem) problems++;
    if (line.incomplete) incomplete++;
  }
  return {
    totalCents,
    marginCents: marginKnown ? marginCents : null,
    problems,
    incomplete,
  };
}

/** One draft line in the shape `createQuote` takes: integer cents throughout. */
export interface QuoteItemInput {
  itemType: QuoteDraftItem["itemType"];
  planId: string | null;
  hardwareId: string | null;
  bundleId: string | null;
  customName: string | null;
  customPriceCents: number | null;
  discountCents: number;
  qty: number;
}

/**
 * A draft as the server takes it, or a refusal naming the line at fault. The
 * save action calls this so an amount the app cannot read stops the save
 * instead of being written to a customer's quote as zero.
 */
export function draftItemsToInput(items: QuoteDraftItem[]): QuoteItemInput[] {
  return items.map((item, index) => {
    const where = `line ${index + 1}`;
    const custom = item.itemType === "custom";
    const priceCents = custom ? readAmountCents(item.customPrice) : null;
    if (custom && priceCents === null) {
      throw new Error(`The price on ${where} is not an amount. ${AMOUNT_HELP}`);
    }
    if (priceCents != null && priceCents < 0) {
      throw new Error(`The price on ${where} must be a positive amount.`);
    }
    const discountCents = readAmountCents(item.discount);
    if (discountCents === null) {
      throw new Error(
        `The discount on ${where} is not an amount. ${AMOUNT_HELP}`
      );
    }
    if (discountCents < 0) {
      throw new Error(`The discount on ${where} must be a positive amount.`);
    }
    return {
      itemType: item.itemType,
      planId: item.planId ?? null,
      hardwareId: item.hardwareId ?? null,
      bundleId: item.bundleId ?? null,
      customName: item.customName ?? null,
      customPriceCents: priceCents,
      discountCents,
      qty: readQty(item.qty),
    };
  });
}
