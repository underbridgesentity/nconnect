import { add, multiply, subtract, type Cents } from "@/lib/money";
import {
  AMOUNT_HELP,
  amountToInput,
  readAmountCents,
} from "@/app/sales/quotes/pricing";

/**
 * Bundle arithmetic, shared by the builder and the save action.
 *
 * A bundle price is a shop-window figure: it ends up on the home page, in the
 * PDF catalogue and in every quote that includes the bundle, so the number the
 * admin sees while composing it and the number written to the catalogue have
 * to be the same one. Both are computed here, in integer cents through
 * `lib/money`.
 *
 * Amounts travel as the text the admin typed, never as rands in a float.
 * `Math.round(rands * 100)` was reading a blank field as R0.00 and quietly
 * publishing it; `parseZar` reads "1 250,50", "R1 250.50" and "1250" alike
 * with integer maths, and text it cannot read is reported rather than saved.
 *
 * The same three helpers price a sales quote (`app/sales/quotes/pricing.ts`),
 * and they are re-exported here so a call site never has to pick between two
 * readers of the same money field.
 */

export { AMOUNT_HELP, amountToInput, readAmountCents };

export interface BundleItemDraft {
  itemType: "plan" | "hardware" | "custom";
  planId?: string;
  hardwareId?: string;
  customName?: string;
  /** What the admin typed for a custom line's price, verbatim. */
  customPrice?: string;
  qty: number;
}

/** A published plan or product as the builder's picker offers it. */
export interface BundleOption {
  id: string;
  name: string;
  priceCents: Cents;
  costCents: Cents | null;
}

/**
 * Quantities are counts, not money: whole and at least one. A cleared number
 * field hands back "", and `Number("")` is 0 while `Number("abc")` is NaN;
 * either reaching `multiply` used to take the whole readout out with it.
 * There is no upper cap because the catalogue has none, so a large bundle
 * stays possible and simply shows a large figure.
 */
export function readQty(typed: string | number): number {
  const parsed =
    typeof typed === "number" ? Math.trunc(typed) : Number.parseInt(typed, 10);
  if (!Number.isSafeInteger(parsed)) return 1;
  return Math.max(1, parsed);
}

/**
 * A typed price in cents, or the reason it cannot be published. One reading
 * serves both the live readout and the save, so they can never differ on what
 * counts as a usable price.
 *
 * An empty field is its own answer. `readAmountCents` reads blank as zero,
 * which is right for a discount nobody typed and wrong for a price: a bundle
 * left blank is one the admin has not priced yet, not one they are giving
 * away. R0.00 stays available by typing it.
 */
function readPrice(
  typed: string | null | undefined,
  where: string
): { cents: Cents | null; problem: string } {
  const text = (typed ?? "").trim();
  if (!text) return { cents: null, problem: `Enter the ${where}.` };
  const cents = readAmountCents(text);
  if (cents === null) {
    return { cents: null, problem: `The ${where} is not an amount. ${AMOUNT_HELP}` };
  }
  if (cents < 0) {
    return { cents: null, problem: `The ${where} must be a positive amount.` };
  }
  return { cents, problem: "" };
}

/**
 * A price the catalogue will publish, or a refusal naming the field. Used on
 * save, where writing an unreadable amount as zero would put a free bundle in
 * the shop window.
 */
export function requirePriceCents(
  typed: string | null | undefined,
  where: string
): Cents {
  const { cents, problem } = readPrice(typed, where);
  if (cents === null) throw new Error(problem);
  return cents;
}

/**
 * A price that may honestly be left out. A custom line reading "Free delivery"
 * with nothing in the price box is a real bundle line, and it is stored with
 * no price rather than with a zero, which is what it has always meant.
 */
export function optionalPriceCents(
  typed: string | null | undefined,
  where: string
): Cents | null {
  if ((typed ?? "").trim() === "") return null;
  return requirePriceCents(typed, where);
}

export interface BundleLine {
  /** Unit price, before quantity. */
  priceCents: Cents;
  /**
   * Unit wholesale cost, or null where a catalogue line has no cost price
   * captured, so "not known" is never displayed as "nothing". A custom line
   * carries no cost by nature and counts as zero, which is how the margin
   * readout has always treated it.
   */
  costCents: Cents | null;
  qty: number;
  /** Unit price times quantity. */
  totalCents: Cents;
  /** Empty when the line is fine, a sentence the admin can act on otherwise. */
  problem: string;
  /** Still missing the product or the name that says what this line is. */
  incomplete: boolean;
}

/** Price one draft line against the catalogue entry it points at. */
export function bundleLine(
  item: BundleItemDraft,
  option: BundleOption | null,
  /** 1-based, so a problem can name the line the admin is looking at. */
  position: number
): BundleLine {
  const custom = item.itemType === "custom";
  const typedPrice = custom ? readAmountCents(item.customPrice) : null;
  const qty = readQty(item.qty);

  // An amount that is unreadable or negative counts as nothing in the totals
  // and is reported through `problem`, which blocks the save, so no such line
  // ever reaches a published bundle.
  const priceCents = custom
    ? Math.max(typedPrice ?? 0, 0)
    : (option?.priceCents ?? 0);
  const costCents = custom ? 0 : (option?.costCents ?? null);

  // A blank custom price is allowed, so only text that is there and cannot be
  // read, or reads negative, is a problem worth stopping the save for.
  const problem =
    custom && (item.customPrice ?? "").trim() !== ""
      ? readPrice(item.customPrice, `price on line ${position}`).problem
      : "";

  return {
    priceCents,
    costCents,
    qty,
    totalCents: multiply(priceCents, qty),
    problem,
    incomplete: custom ? !item.customName?.trim() : option == null,
  };
}

export interface BundleTotals {
  /** What the parts add up to at list price, before the bundle discount. */
  componentPriceCents: Cents;
  /** Wholesale cost of the lines that have one captured. */
  knownCostCents: Cents;
  /** True when a catalogue line has no cost price, so margin is unknowable. */
  costMissing: boolean;
  /** The typed bundle price in cents, or null when it is not usable yet. */
  priceCents: Cents | null;
  /** null when a cost is missing or the bundle price is not usable yet. */
  marginCents: Cents | null;
  /** Every reason the save would be refused, in the admin's words. */
  problems: string[];
  incomplete: number;
}

export function bundleTotals(
  lines: BundleLine[],
  /** The bundle price exactly as typed. */
  typedPrice: string | null | undefined
): BundleTotals {
  let componentPriceCents = 0;
  let knownCostCents = 0;
  let costMissing = false;
  let incomplete = 0;
  const problems: string[] = [];

  for (const line of lines) {
    componentPriceCents = add(componentPriceCents, line.totalCents);
    if (line.costCents == null) costMissing = true;
    else knownCostCents = add(knownCostCents, multiply(line.costCents, line.qty));
    if (line.problem) problems.push(line.problem);
    if (line.incomplete) incomplete++;
  }

  const price = readPrice(typedPrice, "bundle price");
  if (price.problem) problems.push(price.problem);

  return {
    componentPriceCents,
    knownCostCents,
    costMissing,
    priceCents: price.cents,
    marginCents:
      costMissing || price.cents == null
        ? null
        : subtract(price.cents, knownCostCents),
    problems,
    incomplete,
  };
}

/** One bundle line in the shape `upsertBundle` takes: integer cents. */
export interface BundleItemInput {
  itemType: BundleItemDraft["itemType"];
  planId: string | null;
  hardwareId: string | null;
  customName: string | null;
  customPriceCents: number | null;
  qty: number;
}

/**
 * The draft as the server takes it, or a refusal naming the line at fault.
 * The save action calls this so an amount the app cannot read stops the save
 * instead of being published as a zero-rand line in a customer-facing bundle.
 */
export function bundleItemsToInput(
  items: BundleItemDraft[]
): BundleItemInput[] {
  return items.map((item, index) => {
    const custom = item.itemType === "custom";
    const customPriceCents = custom
      ? optionalPriceCents(item.customPrice, `price on line ${index + 1}`)
      : null;
    return {
      itemType: item.itemType,
      planId: item.planId || null,
      hardwareId: item.hardwareId || null,
      customName: item.customName || null,
      customPriceCents,
      qty: readQty(item.qty),
    };
  });
}
