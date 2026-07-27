import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  lt,
  or,
} from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db/client";
import {
  quotes,
  quoteItems,
  leads,
  leadActivities,
  plans,
  hardwareProducts,
  bundles,
  bundleItems,
  customers,
  users,
  notifications,
  orders,
} from "@/lib/db/schema";
import { authorize, type Actor } from "@/lib/auth/authorize";
import { writeAudit } from "./audit";
import { emitDomainEvent, forwardDomainEvent } from "./events";
import { nextNumber } from "./sequences";
import { getSetting, getSettingOr } from "./settings";
import { percentOf, add, multiply, formatCents } from "@/lib/money";
import { formatDateLong } from "@/lib/format";
import { sendEmail } from "@/lib/notify/email";
import { getSmsAdapter } from "@/lib/notify/sms";
import { sendWhatsAppTemplate, whatsappEnabled } from "@/lib/notify/whatsapp";
import { appUrl } from "@/lib/config";

/**
 * Quotes (spec §4.6, §9.5, §10.4). Prices snapshot at creation; per-line
 * discounts are guarded by the floor rule; share links track viewed/accepted.
 */

export class DiscountFloorError extends Error {
  constructor(line: string, detail: string) {
    super(
      `Discount too deep on "${line}": ${detail} Ask an admin to approve a below-floor discount.`
    );
    this.name = "DiscountFloorError";
  }
}

/**
 * Nothing was delivered. The quote stays in its previous status so the rep is
 * never shown a Sent pill for a message that never left the building.
 */
export class QuoteDeliveryError extends Error {
  readonly link: string;
  readonly attempts: string[];
  constructor(message: string, link: string, attempts: string[]) {
    super(message);
    this.name = "QuoteDeliveryError";
    this.link = link;
    this.attempts = attempts;
  }
}

const quoteItemInput = z.object({
  itemType: z.enum(["plan", "hardware", "bundle", "custom"]),
  planId: z.string().uuid().nullish(),
  hardwareId: z.string().uuid().nullish(),
  bundleId: z.string().uuid().nullish(),
  customName: z.string().max(160).nullish(),
  customPriceCents: z.number().int().nonnegative().nullish(),
  discountCents: z.number().int().nonnegative().default(0),
  qty: z.number().int().min(1).max(20).default(1),
});

const quoteInput = z.object({
  leadId: z.string().uuid().nullish(),
  customerId: z.string().uuid().nullish(),
  items: z.array(quoteItemInput).min(1),
});

export interface PricedQuoteLine {
  itemType: "plan" | "hardware" | "bundle" | "custom";
  planId: string | null;
  hardwareId: string | null;
  bundleId: string | null;
  nameSnapshot: string;
  unitPriceCentsSnapshot: number;
  unitCostCentsSnapshot: number | null;
  discountCents: number;
  qty: number;
}

/**
 * Resolve + snapshot + enforce the §10.4 floor:
 * with cost: discounted >= cost × (1 + floor%); without: discount <= 15%.
 * Admins with quote.discount_below_floor bypass.
 */
async function priceQuoteItems(
  actor: Actor,
  items: z.infer<typeof quoteItemInput>[]
): Promise<{ lines: PricedQuoteLine[]; totalCents: number }> {
  const floorPercent = await getSettingOr("min_margin_floor_percent", 10);
  const maxNoCostDiscount = await getSettingOr("no_cost_max_discount_percent", 15);
  let canGoBelowFloor = true;
  try {
    authorize(actor, "quote.discount_below_floor");
  } catch {
    canGoBelowFloor = false;
  }

  const lines: PricedQuoteLine[] = [];
  for (const item of items) {
    let name = item.customName ?? "Custom line";
    let price = item.customPriceCents ?? 0;
    let cost: number | null = null;

    if (item.itemType === "plan" && item.planId) {
      const [plan] = await db
        .select()
        .from(plans)
        .where(and(eq(plans.id, item.planId), eq(plans.status, "published")))
        .limit(1);
      if (!plan) throw new Error("Plan not available");
      name = plan.name;
      price = add(plan.priceCents, plan.onceOffCents);
      cost =
        plan.costCents != null
          ? add(plan.costCents, plan.onceOffCostCents ?? 0)
          : null;
    } else if (item.itemType === "hardware" && item.hardwareId) {
      const [hw] = await db
        .select()
        .from(hardwareProducts)
        .where(
          and(
            eq(hardwareProducts.id, item.hardwareId),
            eq(hardwareProducts.status, "published")
          )
        )
        .limit(1);
      if (!hw) throw new Error("Hardware not available");
      name = hw.name;
      price = hw.priceCents;
      cost = hw.costCents;
    } else if (item.itemType === "bundle" && item.bundleId) {
      const [bundle] = await db
        .select()
        .from(bundles)
        .where(
          and(eq(bundles.id, item.bundleId), eq(bundles.status, "published"))
        )
        .limit(1);
      if (!bundle) throw new Error("Bundle not available");
      name = bundle.name;
      price = bundle.priceCents;
    }

    const discounted = price - item.discountCents;
    if (item.discountCents > 0 && !canGoBelowFloor) {
      if (cost != null) {
        const floor = add(cost, percentOf(cost, floorPercent));
        if (discounted < floor) {
          throw new DiscountFloorError(
            name,
            `the discounted price falls below cost + ${floorPercent}% margin floor.`
          );
        }
      } else {
        const maxDiscount = percentOf(price, maxNoCostDiscount);
        if (item.discountCents > maxDiscount) {
          throw new DiscountFloorError(
            name,
            `no cost price is set, so discounts are capped at ${maxNoCostDiscount}% of sell.`
          );
        }
      }
    }
    if (discounted < 0) throw new Error(`Discount exceeds price on ${name}`);

    lines.push({
      itemType: item.itemType,
      planId: item.planId ?? null,
      hardwareId: item.hardwareId ?? null,
      bundleId: item.bundleId ?? null,
      nameSnapshot: name,
      unitPriceCentsSnapshot: price,
      unitCostCentsSnapshot: cost,
      discountCents: item.discountCents,
      qty: item.qty,
    });
  }

  const totalCents = lines.reduce(
    (sum, l) => add(sum, multiply(l.unitPriceCentsSnapshot - l.discountCents, l.qty)),
    0
  );
  return { lines, totalCents };
}

export async function createQuote(
  actor: Actor,
  input: z.infer<typeof quoteInput>
): Promise<{ quoteId: string; number: string }> {
  authorize(actor, "quote.create", { ownerUserId: actor.userId });
  const data = quoteInput.parse(input);
  const { lines, totalCents } = await priceQuoteItems(actor, data.items);
  const validityDays = await getSettingOr("quote_validity_days", 14);

  return db.transaction(async (tx) => {
    const number = await nextNumber(tx, "Q");
    const [quote] = await tx
      .insert(quotes)
      .values({
        number,
        leadId: data.leadId ?? null,
        customerId: data.customerId ?? null,
        createdBy: actor.userId,
        status: "draft",
        shareToken: randomBytes(18).toString("base64url"),
        expiresAt: new Date(Date.now() + validityDays * 86_400_000),
        totalCents,
      })
      .returning({ id: quotes.id, number: quotes.number });
    await tx
      .insert(quoteItems)
      .values(lines.map((l) => ({ ...l, quoteId: quote.id })));
    await writeAudit(tx, {
      actor,
      action: "quote.create",
      entity: "quote",
      entityId: quote.id,
      after: { number, totalCents, lines: lines.length },
    });
    return { quoteId: quote.id, number: quote.number };
  });
}

// ------------------------------------------------------------------ delivery

export type QuoteChannel = "whatsapp" | "email" | "sms";

export interface QuoteSendResult {
  /** Channels that actually accepted the message. Never empty on success. */
  channels: QuoteChannel[];
  /** Channels that were tried and failed, with the adapter's reason. */
  failures: { channel: QuoteChannel; detail: string }[];
  link: string;
  recipient: { name: string | null; phone: string | null; email: string | null };
}

export function quoteShareLink(shareToken: string): string {
  const base = appUrl();
  return `${base}/q/${shareToken}`;
}

const CHANNEL_LABEL: Record<QuoteChannel, string> = {
  whatsapp: "WhatsApp",
  email: "email",
  sms: "SMS",
};

/** "WhatsApp", "WhatsApp and email", "WhatsApp, email and SMS". */
export function describeChannels(channels: QuoteChannel[]): string {
  const labels = channels.map((c) => CHANNEL_LABEL[c]);
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

export type OrderStatus = (typeof orders.$inferSelect)["status"];

/**
 * Why a quote cannot be sent again, in the rep's words, naming the order and
 * the state it is actually in. Every status in the enum is spelled out: a new
 * one has to be added here before it compiles, so no unpaid or retired order
 * can ever be reported as paid.
 */
function describeQuoteInFlight(
  quoteNumber: string,
  order: { number: string; status: OrderStatus } | null
): string {
  if (!order) {
    return `Quote ${quoteNumber} is already reserved against an order. Duplicate it as a new quote to send fresh pricing.`;
  }
  switch (order.status) {
    case "pending_payment":
      return `Quote ${quoteNumber} has been accepted and order ${order.number} is waiting for payment. The customer's existing link takes them straight back to the payment page, so resending the quote would only confuse them.`;
    case "paid":
      return `Quote ${quoteNumber} has been accepted and paid, order ${order.number}.`;
    case "processing":
      return `Quote ${quoteNumber} has been accepted and paid. Order ${order.number} is being prepared.`;
    case "fulfilled":
      return `Quote ${quoteNumber} has been accepted and paid. Order ${order.number} is complete.`;
    case "cancelled":
      return `Quote ${quoteNumber} was accepted, then order ${order.number} was cancelled and nothing was charged. Duplicate it as a new quote to send fresh pricing.`;
  }
}

/**
 * Send the quote share link. Delivery is attempted first and the status only
 * moves to `sent` once a channel has accepted the message, so a Sent pill in
 * the workspace always means the customer was actually reached. When nothing
 * lands the caller gets a QuoteDeliveryError carrying the link so the rep can
 * deliver it by hand.
 */
export async function sendQuote(
  actor: Actor,
  quoteId: string
): Promise<QuoteSendResult> {
  const [quote] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (!quote) throw new Error("Quote not found");
  authorize(actor, "quote.send", { ownerUserId: quote.createdBy });

  // Acceptance is recorded on the confirmed payment (`acceptQuoteOnPayment`,
  // inside `markOrderPaid`), not when the order is created, so
  // `status === "accepted"` is only ever true once the money has landed and
  // guarding on it alone let a rep resend a quote the customer was already
  // checking out. The real signal that a quote is spoken for is the order
  // reserved against it by `createOrderFromQuote`, which is also what makes a
  // second acceptance impossible.
  if (quote.acceptedOrderId) {
    const [existing] = await db
      .select({ number: orders.number, status: orders.status })
      .from(orders)
      .where(eq(orders.id, quote.acceptedOrderId))
      .limit(1);
    throw new Error(describeQuoteInFlight(quote.number, existing ?? null));
  }
  if (quote.expiresAt && quote.expiresAt.getTime() < Date.now()) {
    throw new Error(
      "This quote has expired. Duplicate it to send a fresh one at current prices."
    );
  }

  let name: string | null = null;
  let phone: string | null = null;
  let email: string | null = null;
  if (quote.leadId) {
    const [lead] = await db
      .select()
      .from(leads)
      .where(eq(leads.id, quote.leadId))
      .limit(1);
    name = lead?.name ?? null;
    phone = lead?.phone ?? null;
    email = lead?.email ?? null;
  } else if (quote.customerId) {
    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, quote.customerId))
      .limit(1);
    name = customer
      ? (customer.companyName ??
        [customer.firstName, customer.lastName].filter(Boolean).join(" "))
      : null;
    phone = customer?.phone ?? null;
    email = customer?.email ?? null;
  }
  if (!phone && !email) {
    throw new Error("The quote needs a lead or customer with contact details");
  }

  const link = quoteShareLink(quote.shareToken);
  const validUntil = quote.expiresAt ? formatDateLong(quote.expiresAt) : null;

  const channels: QuoteChannel[] = [];
  const failures: { channel: QuoteChannel; detail: string }[] = [];

  // In development the email and SMS adapters log to the console and report
  // success. That is useful locally and a lie in production, so once we are
  // live a console-only adapter is treated as an unconfigured channel rather
  // than a delivered one.
  const live = process.env.NODE_ENV === "production";
  const smsAdapter = getSmsAdapter();

  // 1. WhatsApp template, the channel most South African customers read.
  if (phone) {
    if (whatsappEnabled()) {
      const result = await sendWhatsAppTemplate({
        to: phone,
        template: "quote_sent",
        bodyParams: [quote.number, link],
      });
      if (result.ok) channels.push("whatsapp");
      else failures.push({ channel: "whatsapp", detail: result.detail ?? "failed" });
    } else {
      failures.push({ channel: "whatsapp", detail: "WhatsApp is switched off" });
    }
  }

  // 2. Email, the formal record.
  if (email) {
    if (live && !process.env.RESEND_API_KEY) {
      failures.push({ channel: "email", detail: "no email provider configured" });
    } else {
      const result = await sendEmail({
        to: email,
        subject: `Your Needd Connect quote ${quote.number}`,
        html: quoteEmailHtml({
          name,
          number: quote.number,
          totalCents: quote.totalCents,
          link,
          validUntil,
        }),
        text: `Hi ${name ?? "there"}, your Needd Connect quote ${quote.number} for ${formatCents(quote.totalCents)} is ready: ${link}${validUntil ? ` (valid until ${validUntil})` : ""}`,
      });
      if (result.ok) channels.push("email");
      else failures.push({ channel: "email", detail: result.detail ?? "failed" });
    }
  }

  // 3. SMS, the floor under everything: a phone-only lead is always reachable.
  if (phone && channels.length === 0) {
    if (live && smsAdapter.name === "console") {
      failures.push({ channel: "sms", detail: "no SMS provider configured" });
    } else {
      const result = await smsAdapter.send(
        phone,
        `Needd Connect quote ${quote.number}: ${formatCents(quote.totalCents)}. View and accept: ${link}${validUntil ? ` Valid until ${validUntil}.` : ""}`
      );
      if (result.ok) channels.push("sms");
      else failures.push({ channel: "sms", detail: result.detail ?? "failed" });
    }
  }

  if (channels.length === 0) {
    // Record the failed attempt: an undelivered quote is still a fact about
    // the deal, and the rep needs it in the trail when they chase manually.
    await db.transaction(async (tx) => {
      await writeAudit(tx, {
        actor,
        action: "quote.send_failed",
        entity: "quote",
        entityId: quoteId,
        after: { link, failures },
      });
      if (quote.leadId) {
        await tx.insert(leadActivities).values({
          leadId: quote.leadId,
          kind: "note",
          body: `Quote ${quote.number} could not be delivered: ${failures.map((f) => `${CHANNEL_LABEL[f.channel]} (${f.detail})`).join(", ")}. Share the link by hand.`,
          createdBy: actor.userId,
        });
      }
    });
    throw new QuoteDeliveryError(
      `No channel reached ${name ?? "this contact"}: ${failures.map((f) => `${CHANNEL_LABEL[f.channel]} ${f.detail}`).join(", ")}. Copy the share link and send it yourself.`,
      link,
      failures.map((f) => f.channel)
    );
  }

  const eventId = await db.transaction(async (tx) => {
    // A resend must never walk `viewed` back to `sent`.
    if (quote.status === "draft") {
      await tx.update(quotes).set({ status: "sent" }).where(eq(quotes.id, quoteId));
    } else {
      await tx.update(quotes).set({ updatedAt: new Date() }).where(eq(quotes.id, quoteId));
    }
    await writeAudit(tx, {
      actor,
      action: "quote.send",
      entity: "quote",
      entityId: quoteId,
      before: { status: quote.status },
      after: { link, channels, failures },
    });
    if (quote.leadId) {
      await tx
        .update(leads)
        .set({ status: "quoted" })
        .where(
          and(eq(leads.id, quote.leadId), inArray(leads.status, ["new", "contacted"]))
        );
      await tx.insert(leadActivities).values({
        leadId: quote.leadId,
        kind: "status_change",
        body: `Quote ${quote.number} sent by ${describeChannels(channels)}`,
        createdBy: actor.userId,
      });
    }
    return emitDomainEvent(tx, "quote.sent", {
      quoteId,
      createdBy: quote.createdBy,
      channels,
    });
  });
  await forwardDomainEvent(eventId);

  return { channels, failures, link, recipient: { name, phone, email } };
}

function quoteEmailHtml(input: {
  name: string | null;
  number: string;
  totalCents: number;
  link: string;
  validUntil: string | null;
}): string {
  return `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#121829">
  <p>Hi ${input.name ?? "there"},</p>
  <p>Your quote <strong>${input.number}</strong> is ready, ${formatCents(input.totalCents)} due on acceptance.</p>
  <p><a href="${input.link}" style="display:inline-block;background:#136FB0;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none">View your quote</a></p>
  ${input.validUntil ? `<p style="font-size:13px;color:#5b6478">Valid until ${input.validUntil}. Your prices are locked until then.</p>` : ""}
  <p style="font-size:13px;color:#5b6478">The quote page shows the full breakdown, including anything that recurs monthly.</p>
  <p>Needd Connect</p>
</div>`;
}

// ------------------------------------------------------------- pricing split

export interface QuoteLineBreakdown {
  id: string;
  name: string;
  qty: number;
  discountCents: number;
  /** Charged on acceptance: first month plus once-off fees, after discount. */
  payNowCents: number;
  /** Recurring per month from the second month on. Null for once-off lines. */
  monthlyCents: number | null;
  /**
   * False when the catalogue price has moved since the quote was issued, so
   * the monthly figure is the current one rather than the quoted one.
   */
  monthlyMatchesQuote: boolean;
}

export interface QuoteBreakdown {
  lines: QuoteLineBreakdown[];
  payNowCents: number;
  monthlyCents: number;
  /** True when at least one line renews. Drives the "then per month" block. */
  hasRecurring: boolean;
  /** False when any recurring line no longer reconciles with the catalogue. */
  monthlyMatchesQuote: boolean;
}

type QuoteItemRow = typeof quoteItems.$inferSelect;

/**
 * Split each line into "pay now" and "then per month".
 *
 * A plan line snapshots first month + once-off as a single figure, so the
 * recurring portion is read back from the catalogue: that is also the number
 * the billing engine will charge from month two, which makes it the honest
 * one to show. Where the catalogue has moved since the quote was issued the
 * line is flagged rather than quietly reconciled.
 */
export async function quoteBreakdown(
  items: QuoteItemRow[]
): Promise<QuoteBreakdown> {
  const planIds = [...new Set(items.flatMap((i) => (i.planId ? [i.planId] : [])))];
  const bundleIds = [
    ...new Set(items.flatMap((i) => (i.bundleId ? [i.bundleId] : []))),
  ];

  const planRows = planIds.length
    ? await db.select().from(plans).where(inArray(plans.id, planIds))
    : [];
  const planById = new Map(planRows.map((p) => [p.id, p]));

  // Bundle recurring = the monthly price of the plans inside it (same rule as
  // priceCart in lib/domain/orders.ts).
  const bundleMonthly = new Map<string, { monthly: number; listPrice: number }>();
  if (bundleIds.length) {
    const bundleRows = await db
      .select()
      .from(bundles)
      .where(inArray(bundles.id, bundleIds));
    const memberRows = await db
      .select()
      .from(bundleItems)
      .where(inArray(bundleItems.bundleId, bundleIds));
    const memberPlanIds = [
      ...new Set(memberRows.flatMap((m) => (m.planId ? [m.planId] : []))),
    ];
    const memberPlans = memberPlanIds.length
      ? await db.select().from(plans).where(inArray(plans.id, memberPlanIds))
      : [];
    const memberPlanById = new Map(memberPlans.map((p) => [p.id, p]));
    for (const bundle of bundleRows) {
      const monthly = memberRows
        .filter((m) => m.bundleId === bundle.id && m.planId)
        .reduce(
          (sum, m) => add(sum, memberPlanById.get(m.planId!)?.priceCents ?? 0),
          0
        );
      bundleMonthly.set(bundle.id, { monthly, listPrice: bundle.priceCents });
    }
  }

  const lines: QuoteLineBreakdown[] = items.map((item) => {
    const payNowCents = multiply(
      item.unitPriceCentsSnapshot - item.discountCents,
      item.qty
    );
    let monthlyCents: number | null = null;
    let monthlyMatchesQuote = true;

    if (item.itemType === "plan" && item.planId) {
      const plan = planById.get(item.planId);
      if (plan && plan.priceCents > 0) {
        monthlyCents = multiply(plan.priceCents, item.qty);
        monthlyMatchesQuote =
          add(plan.priceCents, plan.onceOffCents) === item.unitPriceCentsSnapshot;
      }
    } else if (item.itemType === "bundle" && item.bundleId) {
      const bundle = bundleMonthly.get(item.bundleId);
      if (bundle && bundle.monthly > 0) {
        monthlyCents = multiply(bundle.monthly, item.qty);
        monthlyMatchesQuote = bundle.listPrice === item.unitPriceCentsSnapshot;
      }
    }

    return {
      id: item.id,
      name: item.nameSnapshot,
      qty: item.qty,
      discountCents: item.discountCents,
      payNowCents,
      monthlyCents,
      monthlyMatchesQuote,
    };
  });

  const recurring = lines.filter((l) => l.monthlyCents != null);
  return {
    lines,
    payNowCents: lines.reduce((sum, l) => add(sum, l.payNowCents), 0),
    monthlyCents: recurring.reduce((sum, l) => add(sum, l.monthlyCents ?? 0), 0),
    hasRecurring: recurring.length > 0,
    monthlyMatchesQuote: recurring.every((l) => l.monthlyMatchesQuote),
  };
}

// -------------------------------------------------------------- public view

/** Public view by token; flips sent -> viewed and stamps first_viewed_at. */
export async function quoteByToken(token: string) {
  const [quote] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.shareToken, token))
    .limit(1);
  if (!quote) return null;
  const items = await db
    .select()
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, quote.id))
    .orderBy(asc(quoteItems.createdAt), asc(quoteItems.id));

  const expired =
    quote.status === "expired" ||
    (quote.expiresAt != null && quote.expiresAt.getTime() < Date.now());

  if (quote.status === "sent" && !expired) {
    const eventId = await db.transaction(async (tx) => {
      await tx
        .update(quotes)
        .set({ status: "viewed", firstViewedAt: quote.firstViewedAt ?? new Date() })
        .where(eq(quotes.id, quote.id));
      return emitDomainEvent(tx, "quote.viewed", {
        quoteId: quote.id,
        createdBy: quote.createdBy,
      });
    });
    await forwardDomainEvent(eventId);
    // Sales bell on viewed (§8).
    const [creator] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, quote.createdBy))
      .limit(1);
    if (creator) {
      await db.insert(notifications).values({
        userId: creator.id,
        type: "quote_viewed",
        title: `Quote ${quote.number} was opened`,
        body: "The customer is looking at it right now.",
        link: `/sales/quotes/${quote.id}`,
      });
    }
    quote.status = "viewed";
  }

  const breakdown = await quoteBreakdown(items);
  return { quote, items, expired, breakdown };
}

/** Rep name and contact for the quote document, so it is signed by a person. */
export async function quoteRep(
  createdBy: string
): Promise<{ name: string | null; phone: string | null; email: string | null } | null> {
  const [rep] = await db
    .select({ name: users.name, phone: users.phone, email: users.email })
    .from(users)
    .where(eq(users.id, createdBy))
    .limit(1);
  return rep ?? null;
}

export interface QuoteCompany {
  legalName: string;
  website: string;
  phone: string;
  /** Mobile that can actually receive WhatsApp; `phone` is a share-call line. */
  whatsapp?: string;
  email: string;
  vat: string;
  reg: string;
  bbbee: string;
}

/**
 * Everything the customer-facing quote needs to read as a real document:
 * who it is for, who wrote it, what recurs, and who the company is. Same
 * footer facts as the invoice PDF (lib/pdf/invoice.tsx).
 */
export async function quoteDocument(token: string) {
  const base = await quoteByToken(token);
  if (!base) return null;

  const [rep, company] = await Promise.all([
    quoteRep(base.quote.createdBy),
    getSetting<QuoteCompany>("company"),
  ]);

  let recipientName: string | null = null;
  if (base.quote.customerId) {
    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, base.quote.customerId))
      .limit(1);
    recipientName = customer
      ? (customer.companyName ??
        [customer.firstName, customer.lastName].filter(Boolean).join(" ") ??
        null)
      : null;
  }
  if (!recipientName && base.quote.leadId) {
    const [lead] = await db
      .select({ name: leads.name })
      .from(leads)
      .where(eq(leads.id, base.quote.leadId))
      .limit(1);
    recipientName = lead?.name ?? null;
  }

  return { ...base, rep, company, recipientName };
}

// ---------------------------------------------------------- workspace reads

export interface QuoteListRow {
  quote: typeof quotes.$inferSelect;
  /** Status as the customer would experience it right now. */
  effectiveStatus: string;
  expiresInDays: number | null;
  leadName: string | null;
  leadId: string | null;
}

/** True once the stored status or the expiry date says the quote is dead. */
export function isQuoteExpired(quote: {
  status: string;
  expiresAt: Date | null;
}): boolean {
  return (
    quote.status === "expired" ||
    (quote.expiresAt != null && quote.expiresAt.getTime() < Date.now())
  );
}

function daysUntil(date: Date | null): number | null {
  if (!date) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

export async function listQuotes(
  actor: Actor,
  opts: { search?: string; limit?: number } = {}
): Promise<QuoteListRow[]> {
  authorize(actor, "quote.create", { ownerUserId: actor.userId });
  const search = opts.search?.trim();
  const term = search ? `%${search}%` : null;

  const rows = await db
    .select({ quote: quotes, leadName: leads.name, leadId: leads.id })
    .from(quotes)
    .leftJoin(leads, eq(leads.id, quotes.leadId))
    .where(
      and(
        actor.role === "admin" ? undefined : eq(quotes.createdBy, actor.userId),
        term
          ? or(ilike(quotes.number, term), ilike(leads.name, term))
          : undefined
      )
    )
    .orderBy(desc(quotes.createdAt))
    .limit(opts.limit ?? 100);

  return rows.map((r) => ({
    quote: r.quote,
    leadName: r.leadName,
    leadId: r.leadId,
    effectiveStatus:
      r.quote.status !== "accepted" && isQuoteExpired(r.quote)
        ? "expired"
        : r.quote.status,
    expiresInDays: daysUntil(r.quote.expiresAt),
  }));
}

/**
 * One quote with everything the detail page needs. Scoped the same way as the
 * list: a rep only ever opens their own quotes.
 */
export async function quoteDetail(actor: Actor, quoteId: string) {
  const [quote] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (!quote) return null;
  try {
    authorize(actor, "quote.send", { ownerUserId: quote.createdBy });
  } catch {
    return null;
  }

  const items = await db
    .select()
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, quote.id))
    .orderBy(asc(quoteItems.createdAt), asc(quoteItems.id));

  const [lead] = quote.leadId
    ? await db.select().from(leads).where(eq(leads.id, quote.leadId)).limit(1)
    : [];
  const [customer] = quote.customerId
    ? await db
        .select()
        .from(customers)
        .where(eq(customers.id, quote.customerId))
        .limit(1)
    : [];

  const breakdown = await quoteBreakdown(items);
  const marginCents = items.reduce((sum, i) => {
    if (i.unitCostCentsSnapshot == null) return sum;
    return add(
      sum,
      multiply(
        i.unitPriceCentsSnapshot - i.discountCents - i.unitCostCentsSnapshot,
        i.qty
      )
    );
  }, 0);
  const marginKnown = items.every(
    (i) => i.itemType === "custom" || i.unitCostCentsSnapshot != null
  );

  return {
    quote,
    items,
    breakdown,
    lead: lead ?? null,
    customer: customer ?? null,
    link: quoteShareLink(quote.shareToken),
    expired: isQuoteExpired(quote),
    expiresInDays: daysUntil(quote.expiresAt),
    marginCents,
    marginKnown,
  };
}

// ------------------------------------------------------------------- expiry

/**
 * Daily sweep: quotes past their validity date stop counting as live work.
 * Returns the number expired so the caller can log it. Accepted quotes are
 * never touched.
 *
 * Neither is a quote whose order is sitting at `pending_payment`: that
 * customer has accepted and is at the PayFast page or on their way back to it.
 * Expiring the quote underneath them would show them an expired quote after
 * they paid, and `createOrderFromQuote` would refuse a retry. The sweep leaves
 * those alone and collects them on a later run, once the order is paid (the
 * quote is marked accepted) or cancelled.
 */
export async function expireQuotes(): Promise<number> {
  const stale = await db
    .select({ id: quotes.id, number: quotes.number, status: quotes.status })
    .from(quotes)
    .where(
      and(
        inArray(quotes.status, ["sent", "viewed"]),
        isNotNull(quotes.expiresAt),
        lt(quotes.expiresAt, new Date())
      )
    );
  if (stale.length === 0) return 0;

  // Read-then-write is safe here: `createOrderFromQuote` already refuses a
  // quote that is past its expiry date, so no new order can appear for any
  // quote in `stale` between this check and the update below.
  const midCheckout = new Set(
    (
      await db
        .select({ quoteId: orders.quoteId })
        .from(orders)
        .where(
          and(
            eq(orders.status, "pending_payment"),
            inArray(
              orders.quoteId,
              stale.map((q) => q.id)
            )
          )
        )
    ).flatMap((row) => (row.quoteId ? [row.quoteId] : []))
  );
  const expiring = stale.filter((quote) => !midCheckout.has(quote.id));
  if (expiring.length === 0) return 0;

  const eventIds: string[] = [];
  for (const quote of expiring) {
    const eventId = await db.transaction(async (tx) => {
      await tx
        .update(quotes)
        .set({ status: "expired" })
        .where(and(eq(quotes.id, quote.id), inArray(quotes.status, ["sent", "viewed"])));
      await writeAudit(tx, {
        actor: null,
        action: "quote.expire",
        entity: "quote",
        entityId: quote.id,
        before: { status: quote.status },
        after: { status: "expired" },
      });
      return emitDomainEvent(tx, "quote.expired", {
        quoteId: quote.id,
        number: quote.number,
      });
    });
    eventIds.push(eventId);
  }
  for (const id of eventIds) await forwardDomainEvent(id);
  return expiring.length;
}

/**
 * Quotes lapsing within `days`, for the chase-list and the reminder bell.
 * Ordered by the tightest deadline first.
 */
export async function quotesExpiringSoon(actor: Actor, days = 3) {
  const now = new Date();
  const cutoff = new Date(now.getTime() + days * 86_400_000);
  return db
    .select()
    .from(quotes)
    .where(
      and(
        actor.role === "admin" ? undefined : eq(quotes.createdBy, actor.userId),
        inArray(quotes.status, ["sent", "viewed"]),
        isNotNull(quotes.expiresAt),
        // Strictly still live: an already-lapsed quote is not "expiring soon",
        // it is dead, and it belongs in the list under its expired pill.
        gte(quotes.expiresAt, now),
        lt(quotes.expiresAt, cutoff)
      )
    )
    .orderBy(asc(quotes.expiresAt))
    .limit(20);
}
