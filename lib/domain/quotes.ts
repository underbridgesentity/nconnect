import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
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
  customers,
  users,
} from "@/lib/db/schema";
import { authorize, type Actor } from "@/lib/auth/authorize";
import { writeAudit } from "./audit";
import { emitDomainEvent, forwardDomainEvent } from "./events";
import { nextNumber } from "./sequences";
import { getSettingOr } from "./settings";
import { percentOf, add, multiply } from "@/lib/money";
import { sendEmail } from "@/lib/notify/email";
import { sendWhatsAppTemplate, whatsappEnabled } from "@/lib/notify/whatsapp";

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

/** Send the quote: share link via WhatsApp + email to the lead/customer. */
export async function sendQuote(actor: Actor, quoteId: string): Promise<void> {
  const [quote] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (!quote) throw new Error("Quote not found");
  authorize(actor, "quote.send", { ownerUserId: quote.createdBy });

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

  const link = `${process.env.APP_URL}/q/${quote.shareToken}`;

  await db.transaction(async (tx) => {
    await tx
      .update(quotes)
      .set({ status: "sent" })
      .where(eq(quotes.id, quoteId));
    await writeAudit(tx, {
      actor,
      action: "quote.send",
      entity: "quote",
      entityId: quoteId,
      after: { link },
    });
    const eventId = await emitDomainEvent(tx, "quote.sent", {
      quoteId,
      createdBy: quote.createdBy,
    });
    void eventId;
    if (quote.leadId) {
      await tx
        .update(leads)
        .set({ status: "quoted" })
        .where(and(eq(leads.id, quote.leadId), inArray(leads.status, ["new", "contacted"])));
      await tx.insert(leadActivities).values({
        leadId: quote.leadId,
        kind: "status_change",
        body: `Quote ${quote.number} sent`,
        createdBy: actor.userId,
      });
    }
  });

  // §8 quote_sent: WhatsApp (link) + email.
  let whatsappSent = false;
  if (whatsappEnabled() && phone) {
    const result = await sendWhatsAppTemplate({
      to: phone,
      template: "quote_sent",
      bodyParams: [quote.number, link],
    });
    whatsappSent = result.ok;
  }
  if (email) {
    await sendEmail({
      to: email,
      subject: `Your Needd Connect quote ${quote.number}`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px"><p>Hi ${name ?? ""},</p><p>Your quote <strong>${quote.number}</strong> is ready.</p><p><a href="${link}">View your quote</a>, valid until ${quote.expiresAt?.toISOString().slice(0, 10)}.</p><p>, Needd Connect</p></div>`,
      text: `Your quote ${quote.number}: ${link}`,
    });
  } else if (!whatsappSent) {
    console.warn(`quote ${quote.number}: no reachable channel (WhatsApp ${whatsappEnabled() ? "failed" : "disabled"}, no email)`);
  }
}

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
    .where(eq(quoteItems.quoteId, quote.id));

  if (quote.status === "sent") {
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
      const { notifications } = await import("@/lib/db/schema");
      await db.insert(notifications).values({
        userId: creator.id,
        type: "quote_viewed",
        title: `Quote ${quote.number} was opened`,
        body: "The customer is looking at it right now.",
        link: `/sales/quotes`,
      });
    }
    quote.status = "viewed";
  }

  const expired =
    quote.expiresAt != null && quote.expiresAt.getTime() < Date.now();
  return { quote, items, expired };
}

export async function listQuotes(actor: Actor) {
  authorize(actor, "quote.create", { ownerUserId: actor.userId });
  return db
    .select()
    .from(quotes)
    .where(actor.role === "admin" ? undefined : eq(quotes.createdBy, actor.userId))
    .orderBy(desc(quotes.createdAt))
    .limit(100);
}
