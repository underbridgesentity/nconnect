import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/lib/db/client";
import {
  customers,
  addresses,
  consents,
  users,
  plans,
  hardwareProducts,
  bundles,
  bundleItems,
  orders,
  orderItems,
  invoices,
  invoiceLines,
  notifications,
  payments,
  ricaRecords,
} from "@/lib/db/schema";
import { add, formatCents, multiply, subtract, type Cents } from "@/lib/money";
import { writeAudit } from "./audit";
import { emitDomainEvent, forwardDomainEvent } from "./events";
import { nextNumber } from "./sequences";
import { encryptSensitive } from "@/lib/crypto";
import { normalizePhone } from "@/lib/auth/otp";

/**
 * Orders (spec §4.3, §9.2): checkout charges once-off fees + hardware + the
 * first month of each subscription. Prices are always read server-side from
 * the catalogue, the client sends identifiers only. Snapshots are mandatory.
 */

export const SIM_CATEGORIES = ["lte_home", "telkom_lte", "sim_data"] as const;

// ------------------------------------------------------------ cart pricing

const cartSchema = z.object({
  planSlugs: z.array(z.string()).default([]),
  hardware: z
    .array(z.object({ sku: z.string(), qty: z.number().int().min(1).max(10) }))
    .default([]),
  bundleSlug: z.string().nullish(),
});
export type Cart = z.infer<typeof cartSchema>;

/**
 * One priced component of a line, so "due now" is never a single unexplained
 * figure. The parts of a line always sum exactly to `unitPriceCents`.
 */
export interface PriceComponent {
  label: string;
  amountCents: number;
  /** True for the recurring portion charged as the first month. */
  recurring?: boolean;
}

export interface PricedLine {
  itemType: "plan" | "hardware" | "bundle";
  planId?: string;
  hardwareId?: string;
  bundleId?: string;
  name: string;
  /** Charged now, per unit. */
  unitPriceCents: number;
  unitCostCents: number | null;
  qty: number;
  monthlyCents: number; // informational: recurring portion, per unit
  onceOffCents: number; // per unit, charged now beyond the first month
  /** What the once-off actually buys, shown to the customer verbatim. */
  onceOffLabel?: string;
  /** Itemised breakdown of `unitPriceCents`, always sums to it. */
  components: PriceComponent[];
  category?: string;
  /** Hardware only: what the warehouse says right now. */
  stockQty?: number;
}

export interface PricedCart {
  lines: PricedLine[];
  totalDueNowCents: number;
  monthlyCents: number;
  requiresRica: boolean;
}

/** Neutral fallback: never claim a fee covers something we cannot verify. */
const ONCE_OFF_FALLBACK = "Once-off fee";

function onceOffLabelFor(metadata: Record<string, unknown>): string {
  const label = metadata?.onceOffLabel;
  return typeof label === "string" && label.trim() ? label.trim() : ONCE_OFF_FALLBACK;
}

/** Price a cart from the catalogue. Throws if anything is unpublished. */
export async function priceCart(input: Cart): Promise<PricedCart> {
  const cart = cartSchema.parse(input);
  const lines: PricedLine[] = [];

  if (cart.planSlugs.length > 0) {
    const planRows = await db
      .select()
      .from(plans)
      .where(
        and(inArray(plans.slug, cart.planSlugs), eq(plans.status, "published"))
      );
    if (planRows.length !== cart.planSlugs.length) {
      throw new Error("One of the chosen plans is no longer available");
    }
    for (const p of planRows) {
      const onceOffLabel = onceOffLabelFor(p.metadata);
      const components: PriceComponent[] = [
        { label: "First month", amountCents: p.priceCents, recurring: true },
      ];
      if (p.onceOffCents > 0) {
        components.push({ label: onceOffLabel, amountCents: p.onceOffCents });
      }
      lines.push({
        itemType: "plan",
        planId: p.id,
        name: p.name,
        unitPriceCents: add(p.priceCents, p.onceOffCents),
        unitCostCents: p.costCents,
        qty: 1,
        monthlyCents: p.priceCents,
        onceOffCents: p.onceOffCents,
        onceOffLabel: p.onceOffCents > 0 ? onceOffLabel : undefined,
        components,
        category: p.category,
      });
    }
  }

  if (cart.hardware.length > 0) {
    const skus = cart.hardware.map((h) => h.sku);
    const hwRows = await db
      .select()
      .from(hardwareProducts)
      .where(
        and(
          inArray(hardwareProducts.sku, skus),
          eq(hardwareProducts.status, "published")
        )
      );
    if (hwRows.length !== skus.length) {
      throw new Error("One of the chosen hardware items is no longer available");
    }
    for (const h of hwRows) {
      const qty = cart.hardware.find((x) => x.sku === h.sku)?.qty ?? 1;
      lines.push({
        itemType: "hardware",
        hardwareId: h.id,
        name: h.name,
        unitPriceCents: h.priceCents,
        unitCostCents: h.costCents,
        qty,
        monthlyCents: 0,
        onceOffCents: h.priceCents,
        components: [{ label: "Once-off", amountCents: h.priceCents }],
        stockQty: h.stockQty,
      });
    }
  }

  if (cart.bundleSlug) {
    const [bundle] = await db
      .select()
      .from(bundles)
      .where(
        and(eq(bundles.slug, cart.bundleSlug), eq(bundles.status, "published"))
      )
      .limit(1);
    if (!bundle) throw new Error("That bundle is no longer available");
    const items = await db
      .select()
      .from(bundleItems)
      .where(eq(bundleItems.bundleId, bundle.id));
    const bundlePlanIds = items.flatMap((i) => (i.planId ? [i.planId] : []));
    const monthly = bundlePlanIds.length
      ? (
          await db.select().from(plans).where(inArray(plans.id, bundlePlanIds))
        ).reduce((sum, p) => sum + p.priceCents, 0)
      : 0;
    // A bundle price normally covers the first month plus once-off items. If
    // it is priced below the plans it contains, the split would be negative:
    // show the one honest figure instead of inventing a breakdown.
    const bundleOnceOff = subtract(bundle.priceCents, monthly);
    const components: PriceComponent[] =
      monthly > 0 && bundleOnceOff >= 0
        ? [
            { label: "First month", amountCents: monthly, recurring: true },
            ...(bundleOnceOff > 0
              ? [{ label: ONCE_OFF_FALLBACK, amountCents: bundleOnceOff }]
              : []),
          ]
        : [{ label: "Bundle price", amountCents: bundle.priceCents }];
    lines.push({
      itemType: "bundle",
      bundleId: bundle.id,
      name: bundle.name,
      unitPriceCents: bundle.priceCents,
      unitCostCents: null,
      qty: 1,
      monthlyCents: monthly,
      onceOffCents: bundleOnceOff > 0 ? bundleOnceOff : 0,
      components,
      category: "bundle",
    });
  }

  if (lines.length === 0) throw new Error("Nothing in the order yet");

  const totalDueNowCents = lines.reduce(
    (sum, l) => add(sum, multiply(l.unitPriceCents, l.qty)),
    0
  );
  const monthlyCents = lines.reduce(
    (sum, l) => add(sum, multiply(l.monthlyCents, l.qty)),
    0
  );

  // SIM-based service in the cart? (bundles: check their plans' categories)
  let requiresRica = lines.some(
    (l) => l.category && (SIM_CATEGORIES as readonly string[]).includes(l.category)
  );
  if (!requiresRica && cart.bundleSlug) {
    const bundleLine = lines.find((l) => l.itemType === "bundle");
    if (bundleLine?.bundleId) {
      const items = await db
        .select()
        .from(bundleItems)
        .where(eq(bundleItems.bundleId, bundleLine.bundleId));
      const planIds = items.flatMap((i) => (i.planId ? [i.planId] : []));
      if (planIds.length) {
        const planRows = await db
          .select()
          .from(plans)
          .where(inArray(plans.id, planIds));
        requiresRica = planRows.some((p) =>
          (SIM_CATEGORIES as readonly string[]).includes(p.category)
        );
      }
    }
  }

  return { lines, totalDueNowCents, monthlyCents, requiresRica };
}

// ------------------------------------------- keeping the order and the cart in step

export interface OrderAddressInput {
  line1: string;
  line2?: string | null;
  suburb?: string | null;
  city: string;
  province?: string | null;
  postalCode?: string | null;
}

function sameAddress(
  a: OrderAddressInput,
  b: {
    line1: string;
    line2: string | null;
    suburb: string | null;
    city: string;
    province: string | null;
    postalCode: string | null;
  }
): boolean {
  const norm = (v?: string | null) => (v ?? "").trim().toLowerCase();
  return (
    norm(a.line1) === norm(b.line1) &&
    norm(a.line2) === norm(b.line2) &&
    norm(a.suburb) === norm(b.suburb) &&
    norm(a.city) === norm(b.city) &&
    norm(a.province) === norm(b.province) &&
    norm(a.postalCode) === norm(b.postalCode)
  );
}

/**
 * Does this pending order still describe exactly what the customer has on
 * screen? Compares the total, every line (product, quantity and the price we
 * snapshotted) and the delivery address. Anything else is stale and must not
 * be paid: the amount charged has to equal the amount shown.
 */
export async function orderMatchesCart(
  orderId: string,
  priced: PricedCart,
  address: OrderAddressInput
): Promise<boolean> {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) return false;
  if (order.totalCents !== priced.totalDueNowCents) return false;

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  if (items.length !== priced.lines.length) return false;

  const key = (l: {
    itemType: string;
    planId?: string | null;
    hardwareId?: string | null;
    bundleId?: string | null;
    qty: number;
    price: number;
  }) =>
    [
      l.itemType,
      l.planId ?? "",
      l.hardwareId ?? "",
      l.bundleId ?? "",
      l.qty,
      l.price,
    ].join("|");
  const have = items
    .map((i) =>
      key({
        itemType: i.itemType,
        planId: i.planId,
        hardwareId: i.hardwareId,
        bundleId: i.bundleId,
        qty: i.qty,
        price: i.unitPriceCentsSnapshot,
      })
    )
    .sort();
  const want = priced.lines
    .map((l) =>
      key({
        itemType: l.itemType,
        planId: l.planId,
        hardwareId: l.hardwareId,
        bundleId: l.bundleId,
        qty: l.qty,
        price: l.unitPriceCents,
      })
    )
    .sort();
  if (have.join(",") !== want.join(",")) return false;

  if (!order.addressId) return false;
  const [row] = await db
    .select()
    .from(addresses)
    .where(eq(addresses.id, order.addressId))
    .limit(1);
  return Boolean(row) && sameAddress(address, row);
}

/**
 * Retire a pending order the customer has moved on from (they changed the
 * cart or the address after reaching review). Never touches a paid order.
 */
export async function cancelStaleOrder(
  orderId: string,
  reason: string
): Promise<void> {
  const eventIds: string[] = [];
  await db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!order || order.status !== "pending_payment") return;
    await tx
      .update(orders)
      .set({ status: "cancelled", notes: reason })
      .where(eq(orders.id, orderId));
    await writeAudit(tx, {
      actor: null,
      action: "order.cancel",
      entity: "order",
      entityId: orderId,
      before: { status: "pending_payment", totalCents: order.totalCents },
      after: { status: "cancelled", reason },
    });
    eventIds.push(
      await emitDomainEvent(tx, "order.cancelled", {
        orderId,
        customerId: order.customerId,
        reason,
      })
    );
  });
  for (const id of eventIds) await forwardDomainEvent(id);
}

// ------------------------------------------------- customer + user creation

export async function findOrCreateCustomer(input: {
  phone: string;
  name: string;
  email?: string | null;
  popiaConsent: boolean;
  marketingWhatsapp?: boolean;
  marketingEmail?: boolean;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ userId: string; customerId: string; created: boolean }> {
  const phone = normalizePhone(input.phone);

  return db.transaction(async (tx) => {
    const [existingUser] = await tx
      .select()
      .from(users)
      .where(eq(users.phone, phone))
      .limit(1);

    let userId: string;
    let customerId: string | undefined;
    let created = false;

    if (existingUser) {
      userId = existingUser.id;
      const [existingCustomer] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.userId, existingUser.id))
        .limit(1);
      customerId = existingCustomer?.id;
    } else {
      const [user] = await tx
        .insert(users)
        .values({ role: "customer", phone, name: input.name, status: "active" })
        .returning({ id: users.id });
      userId = user.id;
      created = true;
    }

    if (!customerId) {
      const nameParts = input.name.trim().split(/\s+/);
      const [customer] = await tx
        .insert(customers)
        .values({
          userId,
          type: "individual",
          firstName: nameParts[0],
          lastName: nameParts.slice(1).join(" ") || null,
          phone,
          email: input.email ?? null,
          source: "web",
        })
        .returning({ id: customers.id });
      customerId = customer.id;
      await writeAudit(tx, {
        actor: null,
        action: "customer.create",
        entity: "customer",
        entityId: customerId,
        after: { phone, name: input.name, source: "web" },
        ip: input.ip,
      });
    }

    // Consents (spec §13): explicit POPIA processing + separate opt-ins.
    const consentRows = [
      { kind: "popia_processing" as const, granted: input.popiaConsent },
      ...(input.marketingWhatsapp !== undefined
        ? [{ kind: "marketing_whatsapp" as const, granted: input.marketingWhatsapp }]
        : []),
      ...(input.marketingEmail !== undefined
        ? [{ kind: "marketing_email" as const, granted: input.marketingEmail }]
        : []),
    ];
    await tx.insert(consents).values(
      consentRows.map((c) => ({
        customerId: customerId!,
        kind: c.kind,
        granted: c.granted,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      }))
    );

    return { userId, customerId, created };
  });
}

// --------------------------------------------------------------- the order

export async function createOrder(input: {
  customerId: string;
  cart: Cart;
  address: {
    line1: string;
    line2?: string | null;
    suburb?: string | null;
    city: string;
    province?: string | null;
    postalCode?: string | null;
  };
  channel?: "web" | "sales" | "admin";
  createdBy?: string | null;
  quoteId?: string | null;
  /**
   * The total the customer was shown. If the catalogue moved between the
   * review screen and this call, we refuse rather than charge a surprise.
   */
  expectedTotalCents?: number;
  rica?: {
    idNumber: string;
    idDocPath: string;
    poaDocPath: string;
  } | null;
}): Promise<{ orderId: string; orderNumber: string; totalCents: number }> {
  const priced = await priceCart(input.cart);
  if (priced.requiresRica && !input.rica) {
    throw new Error("This order includes a SIM service and needs RICA details");
  }
  if (
    input.expectedTotalCents !== undefined &&
    input.expectedTotalCents !== priced.totalDueNowCents
  ) {
    throw new Error(
      "Our prices changed while you were checking out. Please review the new total before paying."
    );
  }

  const result = await db.transaction(async (tx) => {
    const [address] = await tx
      .insert(addresses)
      .values({
        customerId: input.customerId,
        line1: input.address.line1,
        line2: input.address.line2 ?? null,
        suburb: input.address.suburb ?? null,
        city: input.address.city,
        province: input.address.province ?? null,
        postalCode: input.address.postalCode ?? null,
        isPrimary: true,
      })
      .returning({ id: addresses.id });

    const number = await nextNumber(tx, "NC");
    const [order] = await tx
      .insert(orders)
      .values({
        number,
        customerId: input.customerId,
        channel: input.channel ?? "web",
        quoteId: input.quoteId ?? null,
        status: "pending_payment",
        subtotalCents: priced.totalDueNowCents,
        totalCents: priced.totalDueNowCents,
        createdBy: input.createdBy ?? null,
        addressId: address.id,
      })
      .returning({ id: orders.id });

    await tx.insert(orderItems).values(
      priced.lines.map((l) => ({
        orderId: order.id,
        itemType: l.itemType,
        planId: l.planId ?? null,
        hardwareId: l.hardwareId ?? null,
        bundleId: l.bundleId ?? null,
        nameSnapshot: l.name,
        unitPriceCentsSnapshot: l.unitPriceCents,
        unitCostCentsSnapshot: l.unitCostCents,
        qty: l.qty,
      }))
    );

    if (input.rica) {
      await tx.insert(ricaRecords).values({
        customerId: input.customerId,
        serviceId: null,
        idNumberEncrypted: encryptSensitive(input.rica.idNumber),
        idDocPath: input.rica.idDocPath,
        poaDocPath: input.rica.poaDocPath,
        status: "pending",
      });
    }

    await writeAudit(tx, {
      actor: null,
      action: "order.create",
      entity: "order",
      entityId: order.id,
      after: {
        number,
        customerId: input.customerId,
        totalCents: priced.totalDueNowCents,
        items: priced.lines.map((l) => ({ name: l.name, qty: l.qty })),
      },
    });

    return { orderId: order.id, orderNumber: number };
  });

  return { ...result, totalCents: priced.totalDueNowCents };
}

// ------------------------------------------------------------ mark as paid

/** Order statuses, as the database defines them. */
type OrderStatusValue = (typeof orders.$inferSelect)["status"];

/**
 * A payment this system can never bank, however many times it is presented:
 * an order id that does not exist, an amount where no money moved, a card
 * payment with no gateway reference to key idempotency on. A caller answering
 * a gateway must read this as "do not retry", because a retry produces the
 * identical answer while the debit stays unrecorded.
 */
export class UnprocessablePayment extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnprocessablePayment";
  }
}

/** Any uuid shape, whatever version generated it. */
const ORDER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * How money that arrived relates to the order it names.
 *
 * `applied` is the ordinary case, the checkout total arriving once. `overpaid`
 * settles the order and leaves change over. `unallocated` is money the order
 * cannot absorb: it is short of the total, or the order was settled already.
 * All three are banked. The difference is only whether a person has to decide
 * where the money goes.
 */
export type OrderPaymentDisposition = "applied" | "overpaid" | "unallocated";

export type OrderPaymentDecision =
  | {
      accepted: true;
      disposition: OrderPaymentDisposition;
      /** Completed payments against the order once this one is banked. */
      paidTotalCents: Cents;
      /** The part of this payment the order could not absorb. */
      unallocatedCents: Cents;
      /** This payment takes the order to paid. */
      settles: boolean;
      /** Plain words for the audit trail and the operator's queue. */
      note?: string;
    }
  | { accepted: false; reason: string };

/**
 * Pure settlement rule for one order payment, kept away from the database so
 * it can be reasoned about and tested on its own. It is the order-side twin of
 * `gatewayPaymentOutcome` in the billing engine and follows the same law.
 *
 * The governing fact is that the card has already been debited by the time
 * this runs. Refusing the money does not hand it back to the customer, it only
 * removes our record of having taken it. So the only payment refused here is
 * one where nothing moved, an amount of zero or less.
 *
 * Everything else is banked. Money that covers the order total settles the
 * order, with anything over flagged. Money that falls short settles nothing,
 * because half a checkout is not a service anybody can provision, and money
 * that lands on an order already settled belongs to no line on it. Those last
 * two are still recorded against the order, and raised for a person to take
 * the balance, allocate the money elsewhere or refund it.
 */
export function orderPaymentOutcome(input: {
  status: OrderStatusValue;
  totalCents: Cents;
  alreadyPaidCents: Cents;
  amountCents: Cents;
}): OrderPaymentDecision {
  if (input.amountCents <= 0) {
    return { accepted: false, reason: "Payment amount must be more than R0.00" };
  }
  const paidTotalCents = add(input.alreadyPaidCents, input.amountCents);

  // A cancelled order is still settleable: the customer may have had the
  // PayFast page open when we retired it, and money that covers this order is
  // money for this order. Paid, processing and fulfilled orders are not, so a
  // second debit on them is banked without touching the order.
  const settleable =
    input.status === "pending_payment" || input.status === "cancelled";

  if (!settleable) {
    return {
      accepted: true,
      disposition: "unallocated",
      paidTotalCents,
      unallocatedCents: input.amountCents,
      settles: false,
      note:
        `${formatCents(input.amountCents)} arrived for an order that is ` +
        `already ${input.status.replace("_", " ")}, so none of it could be ` +
        `applied to it. It needs allocating to another invoice or refunding.`,
    };
  }

  if (paidTotalCents < input.totalCents) {
    return {
      accepted: true,
      disposition: "unallocated",
      paidTotalCents,
      unallocatedCents: input.amountCents,
      settles: false,
      note:
        `${formatCents(input.amountCents)} arrived against ` +
        `${formatCents(input.totalCents)} due on the order, which leaves ` +
        `${formatCents(subtract(input.totalCents, paidTotalCents))} short. ` +
        `The order is not settled and nothing is provisioned until somebody ` +
        `takes the balance or refunds what was paid.`,
    };
  }

  const unallocatedCents = subtract(paidTotalCents, input.totalCents);
  return {
    accepted: true,
    disposition: unallocatedCents > 0 ? "overpaid" : "applied",
    paidTotalCents,
    unallocatedCents,
    settles: true,
    note:
      unallocatedCents > 0
        ? `${formatCents(input.amountCents)} arrived against ` +
          `${formatCents(input.totalCents)} due on the order. The order is ` +
          `settled and the ${formatCents(unallocatedCents)} over needs ` +
          `allocating or refunding.`
        : undefined,
  };
}

/** Money banked, ignoring initiated and failed attempts. One definition. */
const completedPaymentTotal = sql<number>`coalesce(sum(${payments.amountCents}) filter (where ${payments.status} = 'complete'), 0)::int`;

/**
 * Completed payments already banked against an order, across every invoice
 * raised for it. Call it inside the transaction that will write the payment so
 * the order's row lock covers the read.
 */
async function paidCentsForOrder(tx: Tx, orderId: string): Promise<Cents> {
  const [row] = await tx
    .select({ total: completedPaymentTotal })
    .from(payments)
    .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
    .where(eq(invoices.orderId, orderId));
  return row.total;
}

/**
 * Bell rows for every active admin, written inside the caller's transaction.
 *
 * An admin who has not yet read the bell for this exact exception does not get
 * a second one: a webhook PayFast replays five times is one problem, not five.
 * Once it has been read the next occurrence rings again, because a problem
 * that comes back after somebody looked at it is news.
 */
async function flagForOperator(
  tx: Tx,
  input: { type: string; title: string; body: string; link: string }
): Promise<void> {
  const admins = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.status, "active")));
  if (admins.length === 0) {
    console.error(`no active admin to flag: ${input.title}`);
    return;
  }
  const outstanding = await tx
    .select({ userId: notifications.userId })
    .from(notifications)
    .where(
      and(eq(notifications.type, input.type), isNull(notifications.readAt))
    );
  const alreadyTold = new Set(outstanding.map((n) => n.userId));
  const rows = admins
    .filter((a) => !alreadyTold.has(a.id))
    .map((a) => ({
      userId: a.id,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link,
    }));
  if (rows.length > 0) await tx.insert(notifications).values(rows);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The invoice lines for an order, mirroring what the customer saw at
 * checkout: a plan's first month and its once-off fee are separate lines. The
 * split is only shown when the catalogue still reconciles exactly to the price
 * we charged, so a line can never contradict the amount taken.
 */
async function orderInvoiceLines(
  tx: Tx,
  invoiceId: string,
  items: (typeof orderItems.$inferSelect)[]
): Promise<(typeof invoiceLines.$inferInsert)[]> {
  const planIds = items.flatMap((i) =>
    i.itemType === "plan" && i.planId ? [i.planId] : []
  );
  const planRows = planIds.length
    ? await tx.select().from(plans).where(inArray(plans.id, planIds))
    : [];

  const lineValues: (typeof invoiceLines.$inferInsert)[] = [];
  for (const item of items) {
    const suffix = item.qty > 1 ? ` × ${item.qty}` : "";
    const plan = planRows.find((p) => p.id === item.planId);
    const splits =
      plan &&
      plan.onceOffCents > 0 &&
      add(plan.priceCents, plan.onceOffCents) === item.unitPriceCentsSnapshot;
    if (splits && plan) {
      lineValues.push({
        invoiceId,
        kind: "subscription",
        description: `${item.nameSnapshot}${suffix}, first month`,
        amountCents: multiply(plan.priceCents, item.qty),
        qty: item.qty,
      });
      lineValues.push({
        invoiceId,
        kind: "once_off",
        description: `${item.nameSnapshot}${suffix}, ${onceOffLabelFor(
          plan.metadata
        ).toLowerCase()}`,
        amountCents: multiply(plan.onceOffCents, item.qty),
        qty: item.qty,
      });
      continue;
    }
    lineValues.push({
      invoiceId,
      kind:
        item.itemType === "hardware"
          ? ("hardware" as const)
          : ("once_off" as const),
      description: `${item.nameSnapshot}${suffix}`,
      amountCents: multiply(item.unitPriceCentsSnapshot, item.qty),
      qty: item.qty,
    });
  }
  return lineValues;
}

/**
 * The one invoice an order's money hangs on, created here if it does not
 * exist yet. A payment row cannot exist without an invoice, so money that
 * arrives for an order we are not settling still needs one: it is raised as a
 * draft, which no dunning sweep and no automatic charge will ever touch, and
 * an operator decides what becomes of it. When a later payment does settle the
 * order, that same draft is the invoice that flips to paid, so an order never
 * ends up with two invoices for one checkout.
 */
async function ensureOrderInvoice(
  tx: Tx,
  order: typeof orders.$inferSelect,
  items: (typeof orderItems.$inferSelect)[],
  settling: boolean,
  now: Date
): Promise<{
  id: string;
  number: string;
  created: boolean;
  /** The invoice status at the moment this money landed. */
  statusOnArrival: string;
}> {
  const [existing] = await tx
    .select()
    .from(invoices)
    .where(eq(invoices.orderId, order.id))
    .orderBy(asc(invoices.createdAt))
    .limit(1);

  if (existing) {
    if (settling && existing.status !== "paid") {
      await tx
        .update(invoices)
        .set({ status: "paid", paidAt: now })
        .where(eq(invoices.id, existing.id));
    }
    return {
      id: existing.id,
      number: existing.number,
      created: false,
      statusOnArrival: existing.status,
    };
  }

  const number = await nextNumber(tx, "INV");
  const today = now.toISOString().slice(0, 10);
  const [invoice] = await tx
    .insert(invoices)
    .values({
      number,
      customerId: order.customerId,
      orderId: order.id,
      issueDate: today,
      dueDate: today,
      status: settling ? "paid" : "draft",
      subtotalCents: order.subtotalCents,
      totalCents: order.totalCents,
      paidAt: settling ? now : null,
    })
    .returning({ id: invoices.id });

  const lineValues = await orderInvoiceLines(tx, invoice.id, items);
  if (lineValues.length > 0) await tx.insert(invoiceLines).values(lineValues);

  return {
    id: invoice.id,
    number,
    created: true,
    statusOnArrival: settling ? "paid" : "draft",
  };
}

export interface OrderPaymentResult {
  ok: boolean;
  /** This gateway ref was already banked; nothing was written this time. */
  alreadyPaid: boolean;
  /** This call took the order to paid. */
  settled: boolean;
  /** The order is in the paid state now, by this call or an earlier one. */
  orderPaid: boolean;
  disposition: OrderPaymentDisposition | "duplicate";
  /** Banked money the order could not absorb, waiting on an operator. */
  unallocatedCents: Cents;
  /** The invoice the money is recorded against, when there is one. */
  invoiceId?: string;
}

/**
 * The single paid-path for orders, called by the ITN webhook and by
 * admin-assisted "mark paid". Creates or reuses the order invoice, banks the
 * payment and, when the money covers the order, settles it and emits
 * order.paid. If the order came from a quote, this is also where the quote is
 * won: accepted, attributed to the rep, lead marked won (§9.5).
 *
 * The one rule this function will not break is that money PayFast says it took
 * is always written down. Idempotency is on the gateway reference and nothing
 * else, never on the order status: a replayed ITN carries a reference already
 * banked and writes nothing, while a customer who paid twice in two tabs
 * carries a new one, and that second debit is as real as the first. An amount
 * that is not the order total is a permanent condition no retry can fix, so it
 * is banked against the order and raised for a person rather than thrown at
 * the gateway until it gives up.
 */
export async function markOrderPaid(input: {
  orderId: string;
  gatewayRef: string | null;
  amountCents: number;
  method: "payfast_card" | "eft_manual";
  recordedBy?: string | null;
}): Promise<OrderPaymentResult> {
  // An id the database cannot even be asked about. Postgres raises on a
  // malformed uuid, which would read as a fault worth retrying, when in truth
  // no retry will ever turn this reference into an order of ours.
  if (!ORDER_ID_PATTERN.test(input.orderId)) {
    throw new UnprocessablePayment(
      `"${input.orderId}" is not an order reference this system issued`
    );
  }

  const gatewayRef = input.gatewayRef?.trim() || null;
  if (!gatewayRef && input.method !== "eft_manual") {
    // Without a reference there is no idempotency key and a retry would bank
    // the same money twice. Refuse before anything is written.
    throw new UnprocessablePayment(
      "A gateway reference is required to bank a card payment"
    );
  }

  const eventIds: string[] = [];
  const outcome = await db.transaction(async (tx) => {
    // Row lock, like every other money path. A PayFast ITN and an operator
    // clicking "mark paid" can land together; without the lock both read
    // pending_payment, both write an invoice and the customer is billed for
    // one order twice.
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .limit(1)
      .for("update");
    if (!order) throw new UnprocessablePayment("Order not found");

    // The gateway ref is the idempotency key, so it is checked first and on
    // its own. A replayed ITN carries a ref we have already banked. A genuine
    // second debit carries a new one, and that money is real whatever state
    // the order happens to be in.
    if (gatewayRef) {
      const [duplicate] = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(eq(payments.gatewayRef, gatewayRef))
        .limit(1);
      if (duplicate) {
        const [invoice] = await tx
          .select({ id: invoices.id })
          .from(invoices)
          .where(eq(invoices.orderId, order.id))
          .orderBy(asc(invoices.createdAt))
          .limit(1);
        return {
          order,
          alreadyPaid: true as const,
          disposition: "duplicate" as const,
          settled: false,
          unallocatedCents: 0,
          invoiceId: invoice?.id,
        };
      }
    }

    const alreadyPaidCents = await paidCentsForOrder(tx, order.id);
    if (!gatewayRef && alreadyPaidCents > 0) {
      // Manual capture with no reference on an order that already has money
      // banked. There is nothing to tell a fresh deposit from a double click,
      // and no money is lost by asking: the operator has the bank reference in
      // front of them.
      throw new Error(
        "This order already has a payment recorded. Enter the bank reference " +
          "for the new deposit so it can be recorded on its own."
      );
    }

    const decision = orderPaymentOutcome({
      status: order.status,
      totalCents: order.totalCents,
      alreadyPaidCents,
      amountCents: input.amountCents,
    });
    // Only a zero or negative amount gets here, which means no money moved.
    if (!decision.accepted) throw new UnprocessablePayment(decision.reason);

    const now = new Date();
    const items = await tx
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));
    const invoice = await ensureOrderInvoice(
      tx,
      order,
      items,
      decision.settles,
      now
    );

    const [payment] = await tx
      .insert(payments)
      .values({
        invoiceId: invoice.id,
        method: input.method,
        amountCents: input.amountCents,
        status: "complete",
        gatewayRef,
        recordedBy: input.recordedBy ?? null,
      })
      .returning({ id: payments.id });

    // The identity an operator resolves the exception against. Normally the
    // gateway reference, which is unique across payments; a manual capture
    // with no reference falls back to the payment row, so the queue can still
    // close exactly one exception.
    const paymentIdentity = gatewayRef ?? payment.id;

    const actor = input.recordedBy
      ? { userId: input.recordedBy, role: "admin" as const }
      : null;

    if (decision.settles) {
      await tx
        .update(orders)
        .set({
          status: "paid",
          paidAt: now,
          payfastRef: gatewayRef ?? order.payfastRef,
        })
        .where(eq(orders.id, order.id));

      // Decrement hardware stock now that it's sold.
      for (const item of items) {
        if (item.hardwareId) {
          await tx
            .update(hardwareProducts)
            .set({ stockQty: sqlDecrement(item.qty) })
            .where(eq(hardwareProducts.id, item.hardwareId));
        }
      }

      await writeAudit(tx, {
        actor,
        action: "order.paid",
        entity: "order",
        entityId: order.id,
        before: { status: order.status, paidCents: alreadyPaidCents },
        after: {
          status: "paid",
          method: input.method,
          gatewayRef,
          amountCents: input.amountCents,
          paidCents: decision.paidTotalCents,
          unallocatedCents: decision.unallocatedCents,
          disposition: decision.disposition,
          invoiceNumber: invoice.number,
          ...(order.status === "cancelled"
            ? { note: "Payment arrived for an order that had been retired" }
            : {}),
        },
      });

      eventIds.push(
        await emitDomainEvent(tx, "order.paid", {
          orderId: order.id,
          customerId: order.customerId,
          invoiceId: invoice.id,
        })
      );
    } else {
      await writeAudit(tx, {
        actor,
        action: "payment.unallocated",
        entity: "order",
        entityId: order.id,
        before: { status: order.status, paidCents: alreadyPaidCents },
        after: {
          status: order.status,
          method: input.method,
          gatewayRef,
          amountCents: input.amountCents,
          paidCents: decision.paidTotalCents,
          unallocatedCents: decision.unallocatedCents,
          disposition: decision.disposition,
          invoiceNumber: invoice.number,
          note: decision.note ?? "",
        },
      });
    }

    eventIds.push(
      await emitDomainEvent(tx, "payment.received", {
        invoiceId: invoice.id,
        orderId: order.id,
        customerId: order.customerId,
        amountCents: input.amountCents,
        method: input.method,
        settled: decision.settles,
        disposition: decision.disposition,
        unallocatedCents: decision.unallocatedCents,
      })
    );

    if (decision.unallocatedCents > 0) {
      eventIds.push(
        // Same shape the invoice path emits, because the operator's
        // unallocated queue (§16.4) reads these events and one queue has to
        // show every payment nobody could apply, whatever it arrived for.
        await emitDomainEvent(tx, "payment.unallocated", {
          orderId: order.id,
          orderNumber: order.number,
          invoiceId: invoice.id,
          invoiceStatus: invoice.statusOnArrival,
          customerId: order.customerId,
          gatewayRef: paymentIdentity,
          paymentId: payment.id,
          method: input.method,
          amountCents: input.amountCents,
          unallocatedCents: decision.unallocatedCents,
          orderStatus: order.status,
          reason: decision.note ?? "",
        })
      );
      await flagForOperator(tx, {
        type: `payment_unallocated:${paymentIdentity}`,
        title: decision.settles
          ? `Allocate ${formatCents(decision.unallocatedCents)} received on order ${order.number}`
          : `${formatCents(input.amountCents)} received on order ${order.number} needs a decision`,
        body: decision.note ?? "",
        link: `/admin/customers/${order.customerId}?tab=billing`,
      });
      console.warn(
        `unallocated payment: order=${order.id} number=${order.number} ` +
          `status=${order.status} gatewayRef=${gatewayRef ?? "none"} ` +
          `amountCents=${input.amountCents} ` +
          `unallocatedCents=${decision.unallocatedCents}`
      );
    }

    // An order that came from a quote wins the quote here, at the confirmed
    // payment that settles it, and not when the order was created (§9.5).
    if (decision.settles && order.quoteId) {
      eventIds.push(
        ...(await acceptQuoteOnPayment(tx, {
          quoteId: order.quoteId,
          orderId: order.id,
          orderNumber: order.number,
          customerId: order.customerId,
        }))
      );
    }

    return {
      order,
      alreadyPaid: false,
      disposition: decision.disposition,
      settled: decision.settles,
      unallocatedCents: decision.unallocatedCents,
      invoiceId: invoice.id,
    };
  });

  for (const id of eventIds) await forwardDomainEvent(id);

  return {
    ok: true,
    alreadyPaid: outcome.alreadyPaid,
    settled: outcome.settled,
    orderPaid: outcome.settled || outcome.order.status === "paid",
    disposition: outcome.disposition,
    unallocatedCents: outcome.unallocatedCents,
    invoiceId: outcome.invoiceId,
  };
}

function sqlDecrement(by: number) {
  return sql`greatest(stock_qty - ${by}, 0)`;
}

// ------------------------------------------- provisioning a paid order

/**
 * Create the services a paid order bought, and make a failure something a
 * person can see and act on.
 *
 * The money is already banked by the time this runs, so a transient fault here
 * leaves a customer who has paid and has no service. It is never swallowed
 * into a log line: it lands as an audit row, a domain event that can be
 * replayed, and a bell for every operator. The work itself is idempotent, so a
 * replayed ITN or an operator retrying is a safe second chance.
 */
export async function provisionPaidOrder(orderId: string): Promise<{
  ok: boolean;
  serviceIds: string[];
  error?: string;
}> {
  try {
    const { createServicesForPaidOrder } = await import("./services");
    return { ok: true, serviceIds: await createServicesForPaidOrder(orderId) };
  } catch (err) {
    await recordProvisioningFailure(orderId, errorText(err));
    return { ok: false, serviceIds: [], error: errorText(err) };
  }
}

async function recordProvisioningFailure(
  orderId: string,
  detail: string
): Promise<void> {
  console.error(`ORDER NOT PROVISIONED: order=${orderId}: ${detail}`);
  const eventIds: string[] = [];
  try {
    await db.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);
      const label = order?.number ?? orderId;
      await writeAudit(tx, {
        actor: null,
        action: "order.provisioning_failed",
        entity: "order",
        entityId: orderId,
        after: { orderNumber: order?.number ?? null, detail },
      });
      eventIds.push(
        await emitDomainEvent(tx, "order.provisioning_failed", {
          orderId,
          orderNumber: order?.number ?? null,
          customerId: order?.customerId ?? null,
          detail,
        })
      );
      await flagForOperator(tx, {
        type: `order_provisioning_failed:${orderId}`,
        title: `Order ${label} is paid but has no services yet`,
        body:
          `Creating the services for this paid order failed: ${detail}. The ` +
          `payment is recorded. Once the cause is fixed, provisioning can be ` +
          `run again for this order.`,
        link: order
          ? `/admin/customers/${order.customerId}?tab=services`
          : "/admin",
      });
    });
  } catch (err) {
    // The bell itself failed. Nothing else can be done from here, but the log
    // above already carries the order id and the original cause.
    console.error(`could not record provisioning failure for ${orderId}:`, err);
  }
  for (const id of eventIds) await forwardDomainEvent(id);
}

/**
 * Money the gateway confirms that this system cannot attach to anything: an
 * order id it does not know, an amount of zero, an amount that cannot be read
 * at all. There is no invoice to hang a payment row on, so the record is an
 * audit row, a domain event and a bell, which is what a person needs to find
 * the debit at PayFast and place it by hand. Amount 0 means "unknown", never
 * "nothing".
 */
export async function recordUnbankablePayment(input: {
  gatewayRef: string;
  amountCents: number;
  reference: string;
  detail: string;
}): Promise<void> {
  const amount =
    input.amountCents > 0
      ? formatCents(input.amountCents)
      : "An amount we could not read";
  const eventIds: string[] = [];
  try {
    await db.transaction(async (tx) => {
      await writeAudit(tx, {
        actor: null,
        action: "payment.exception",
        entity: "payment",
        entityId: input.gatewayRef,
        after: {
          gatewayRef: input.gatewayRef,
          amountCents: input.amountCents,
          reference: input.reference,
          detail: input.detail,
        },
      });
      eventIds.push(
        await emitDomainEvent(tx, "payment.exception", {
          gatewayRef: input.gatewayRef,
          amountCents: input.amountCents,
          reference: input.reference,
          detail: input.detail,
        })
      );
      await flagForOperator(tx, {
        type: `payment_exception:${input.gatewayRef}`,
        title: `${amount} was received and could not be recorded`,
        body:
          `PayFast confirmed a payment under ${input.gatewayRef} for ` +
          `${input.reference} that could not be banked: ${input.detail}. Find ` +
          `it at PayFast and place it by hand.`,
        link: "/admin/billing?tab=payments",
      });
    });
  } catch (err) {
    console.error(
      `could not record unbankable payment ${input.gatewayRef}:`,
      err
    );
  }
  for (const id of eventIds) await forwardDomainEvent(id);
}

// ------------------------------------------------ order from accepted quote

/**
 * Create an order from a quote's snapshots (spec §9.5, §10.4): pricing is
 * locked to the quote, including per-line discounts.
 *
 * Creating the order does not win the quote. The customer still has to pay,
 * and until the payment is confirmed the quote keeps its own status, the rep
 * keeps no attribution and the lead stays where it is. `markOrderPaid`
 * records all three. The only thing written on the quote here is the order it
 * belongs to, which is what stops a second acceptance and what lets a
 * customer who abandoned PayFast return to the same checkout.
 */
export async function createOrderFromQuote(input: {
  quoteId: string;
  customerId: string;
  address: {
    line1: string;
    line2?: string | null;
    suburb?: string | null;
    city: string;
    province?: string | null;
    postalCode?: string | null;
  };
  rica?: { idNumber: string; idDocPath: string; poaDocPath: string } | null;
}): Promise<{ orderId: string; orderNumber: string; totalCents: number }> {
  const { quotes, quoteItems } = await import("@/lib/db/schema");

  return db.transaction(async (tx) => {
    const [quote] = await tx
      .select()
      .from(quotes)
      .where(eq(quotes.id, input.quoteId))
      .limit(1);
    if (!quote) throw new Error("Quote not found");
    if (quote.acceptedOrderId) throw new Error("Quote already accepted");
    if (quote.expiresAt && quote.expiresAt.getTime() < Date.now()) {
      throw new Error("This quote has expired, ask your rep for a fresh one");
    }
    const items = await tx
      .select()
      .from(quoteItems)
      .where(eq(quoteItems.quoteId, input.quoteId));
    if (items.length === 0) throw new Error("Quote has no items");

    // RICA requirement from the quoted plans.
    const planIds = items.flatMap((i) => (i.planId ? [i.planId] : []));
    let requiresRica = false;
    if (planIds.length) {
      const planRows = await tx
        .select()
        .from(plans)
        .where(inArray(plans.id, planIds));
      requiresRica = planRows.some((p) =>
        (SIM_CATEGORIES as readonly string[]).includes(p.category)
      );
    }
    if (requiresRica && !input.rica) {
      throw new Error("This quote includes a SIM service and needs RICA details");
    }

    const totalCents = items.reduce(
      (sum, i) =>
        add(sum, multiply(i.unitPriceCentsSnapshot - i.discountCents, i.qty)),
      0
    );

    const [address] = await tx
      .insert(addresses)
      .values({
        customerId: input.customerId,
        line1: input.address.line1,
        line2: input.address.line2 ?? null,
        suburb: input.address.suburb ?? null,
        city: input.address.city,
        province: input.address.province ?? null,
        postalCode: input.address.postalCode ?? null,
        isPrimary: true,
      })
      .returning({ id: addresses.id });

    const number = await nextNumber(tx, "NC");
    const [order] = await tx
      .insert(orders)
      .values({
        number,
        customerId: input.customerId,
        channel: "sales",
        quoteId: input.quoteId,
        status: "pending_payment",
        subtotalCents: totalCents,
        totalCents,
        createdBy: quote.createdBy,
        addressId: address.id,
      })
      .returning({ id: orders.id });

    await tx.insert(orderItems).values(
      items.map((i) => ({
        orderId: order.id,
        itemType: i.itemType,
        planId: i.planId,
        hardwareId: i.hardwareId,
        bundleId: i.bundleId,
        nameSnapshot:
          i.discountCents > 0
            ? `${i.nameSnapshot} (quote discount applied)`
            : i.nameSnapshot,
        unitPriceCentsSnapshot: i.unitPriceCentsSnapshot - i.discountCents,
        unitCostCentsSnapshot: i.unitCostCentsSnapshot,
        qty: i.qty,
      }))
    );

    if (input.rica) {
      await tx.insert(ricaRecords).values({
        customerId: input.customerId,
        serviceId: null,
        idNumberEncrypted: encryptSensitive(input.rica.idNumber),
        idDocPath: input.rica.idDocPath,
        poaDocPath: input.rica.poaDocPath,
        status: "pending",
      });
    }

    // The quote is reserved against this order so nobody can accept it twice
    // and the customer can return to the payment page. It is not yet
    // "accepted", the rep is not yet credited and the lead has not been won:
    // the customer is on their way to PayFast and may never arrive. All of
    // that happens in `markOrderPaid` once the money is confirmed (§9.5).
    await tx
      .update(quotes)
      .set({ acceptedOrderId: order.id, customerId: input.customerId })
      .where(eq(quotes.id, input.quoteId));

    await writeAudit(tx, {
      actor: null,
      action: "order.create",
      entity: "order",
      entityId: order.id,
      after: {
        number,
        customerId: input.customerId,
        quoteId: input.quoteId,
        quoteNumber: quote.number,
        totalCents,
        items: items.map((i) => ({ name: i.nameSnapshot, qty: i.qty })),
      },
    });
    await writeAudit(tx, {
      actor: null,
      action: "quote.order_created",
      entity: "quote",
      entityId: input.quoteId,
      before: { status: quote.status, acceptedOrderId: null },
      after: {
        status: quote.status,
        orderId: order.id,
        orderNumber: number,
        totalCents,
        note: "Order created, awaiting payment",
      },
    });

    return { orderId: order.id, orderNumber: number, totalCents };
  });
}

// -------------------------------------------- quote accepted once it is paid

/**
 * Record a quote as won, on the confirmed payment and never before.
 *
 * `createOrderFromQuote` only reserves the quote against its order, because a
 * quote abandoned at the payment page is not revenue and a rep should not be
 * credited for it. This runs inside the `markOrderPaid` transaction and does
 * the rest: the accepted status, the attribution to the rep, and the lead
 * flipped to won. Idempotent, so a replayed ITN writes it once.
 */
async function acceptQuoteOnPayment(
  tx: Tx,
  input: {
    quoteId: string;
    orderId: string;
    orderNumber: string;
    customerId: string;
  }
): Promise<string[]> {
  const { quotes, leads, leadActivities } = await import("@/lib/db/schema");
  const [quote] = await tx
    .select()
    .from(quotes)
    .where(eq(quotes.id, input.quoteId))
    .limit(1);
  if (!quote || quote.status === "accepted") return [];

  await tx
    .update(quotes)
    .set({
      status: "accepted",
      acceptedOrderId: input.orderId,
      customerId: input.customerId,
    })
    .where(eq(quotes.id, input.quoteId));

  // Attribution: the customer who paid a quote belongs to the rep (§9.5).
  await tx
    .update(customers)
    .set({ assignedSalesId: quote.createdBy })
    .where(eq(customers.id, input.customerId));

  if (quote.leadId) {
    await tx
      .update(leads)
      .set({ status: "won", convertedCustomerId: input.customerId })
      .where(eq(leads.id, quote.leadId));
    await tx.insert(leadActivities).values({
      leadId: quote.leadId,
      kind: "status_change",
      body: `Quote ${quote.number} paid, order ${input.orderNumber}`,
      createdBy: quote.createdBy,
    });
  }

  await writeAudit(tx, {
    actor: null,
    action: "quote.accept",
    entity: "quote",
    entityId: quote.id,
    before: { status: quote.status },
    after: {
      status: "accepted",
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      totalCents: quote.totalCents,
      note: "Recorded on confirmed payment",
    },
  });

  return [
    await emitDomainEvent(tx, "quote.accepted", {
      quoteId: quote.id,
      orderId: input.orderId,
      customerId: input.customerId,
      leadId: quote.leadId,
      createdBy: quote.createdBy,
    }),
  ];
}
