import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
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
  payments,
  ricaRecords,
} from "@/lib/db/schema";
import { add, multiply } from "@/lib/money";
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

export interface PricedLine {
  itemType: "plan" | "hardware" | "bundle";
  planId?: string;
  hardwareId?: string;
  bundleId?: string;
  name: string;
  unitPriceCents: number;
  unitCostCents: number | null;
  qty: number;
  monthlyCents: number; // informational: recurring portion
  onceOffCents: number; // charged now beyond first month
  category?: string;
}

export interface PricedCart {
  lines: PricedLine[];
  totalDueNowCents: number;
  monthlyCents: number;
  requiresRica: boolean;
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
      lines.push({
        itemType: "plan",
        planId: p.id,
        name: p.name,
        unitPriceCents: add(p.priceCents, p.onceOffCents),
        unitCostCents: p.costCents,
        qty: 1,
        monthlyCents: p.priceCents,
        onceOffCents: p.onceOffCents,
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
        onceOffCents: multiply(h.priceCents, qty),
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
    lines.push({
      itemType: "bundle",
      bundleId: bundle.id,
      name: bundle.name,
      unitPriceCents: bundle.priceCents,
      unitCostCents: null,
      qty: 1,
      monthlyCents: monthly,
      onceOffCents: bundle.priceCents - monthly,
      category: "bundle",
    });
  }

  if (lines.length === 0) throw new Error("Nothing in the order yet");

  const totalDueNowCents = lines.reduce(
    (sum, l) => add(sum, multiply(l.unitPriceCents, l.qty)),
    0
  );
  const monthlyCents = lines.reduce((sum, l) => add(sum, l.monthlyCents), 0);

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

/**
 * The single paid-path for orders, called by the ITN webhook and by
 * admin-assisted "mark paid". Idempotent on the order status; creates the
 * order invoice + payment record and emits order.paid (M3 provisions from
 * that event).
 */
export async function markOrderPaid(input: {
  orderId: string;
  gatewayRef: string | null;
  amountCents: number;
  method: "payfast_card" | "eft_manual";
  recordedBy?: string | null;
}): Promise<{ ok: boolean; alreadyPaid?: boolean; invoiceId?: string }> {
  const eventIds: string[] = [];
  const result = await db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .limit(1);
    if (!order) throw new Error("Order not found");
    if (order.status !== "pending_payment") {
      return { ok: true, alreadyPaid: true as const };
    }
    if (input.amountCents !== order.totalCents) {
      throw new Error(
        `Amount mismatch: got ${input.amountCents}, expected ${order.totalCents}`
      );
    }

    const now = new Date();
    await tx
      .update(orders)
      .set({ status: "paid", paidAt: now, payfastRef: input.gatewayRef })
      .where(eq(orders.id, order.id));

    const items = await tx
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));

    const invNumber = await nextNumber(tx, "INV");
    const today = now.toISOString().slice(0, 10);
    const [invoice] = await tx
      .insert(invoices)
      .values({
        number: invNumber,
        customerId: order.customerId,
        orderId: order.id,
        issueDate: today,
        dueDate: today,
        status: "paid",
        subtotalCents: order.subtotalCents,
        totalCents: order.totalCents,
        paidAt: now,
      })
      .returning({ id: invoices.id });

    await tx.insert(invoiceLines).values(
      items.map((item) => ({
        invoiceId: invoice.id,
        kind:
          item.itemType === "hardware"
            ? ("hardware" as const)
            : ("once_off" as const),
        description: `${item.nameSnapshot}${item.qty > 1 ? ` × ${item.qty}` : ""}`,
        amountCents: item.unitPriceCentsSnapshot * item.qty,
        qty: item.qty,
      }))
    );

    await tx.insert(payments).values({
      invoiceId: invoice.id,
      method: input.method,
      amountCents: input.amountCents,
      status: "complete",
      gatewayRef: input.gatewayRef,
      recordedBy: input.recordedBy ?? null,
    });

    // Decrement hardware stock now that it's sold.
    for (const item of items) {
      if (item.hardwareId) {
        await tx
          .update(hardwareProducts)
          .set({
            stockQty: sqlDecrement(item.qty),
          })
          .where(eq(hardwareProducts.id, item.hardwareId));
      }
    }

    await writeAudit(tx, {
      actor: input.recordedBy
        ? { userId: input.recordedBy, role: "admin" }
        : null,
      action: "order.paid",
      entity: "order",
      entityId: order.id,
      before: { status: "pending_payment" },
      after: {
        status: "paid",
        gatewayRef: input.gatewayRef,
        invoiceNumber: invNumber,
      },
    });

    eventIds.push(
      await emitDomainEvent(tx, "order.paid", {
        orderId: order.id,
        customerId: order.customerId,
        invoiceId: invoice.id,
      }),
      await emitDomainEvent(tx, "payment.received", {
        invoiceId: invoice.id,
        orderId: order.id,
        customerId: order.customerId,
        amountCents: input.amountCents,
      })
    );

    return { ok: true, invoiceId: invoice.id };
  });

  for (const id of eventIds) await forwardDomainEvent(id);
  return result;
}

function sqlDecrement(by: number) {
  return sql`greatest(stock_qty - ${by}, 0)`;
}

// ------------------------------------------------ order from accepted quote

/**
 * Create an order from a quote's snapshots (spec §9.5, §10.4): pricing is
 * locked to the quote (including per-line discounts), the customer is
 * attributed to the rep, and the lead (if any) flips to won on payment.
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

    // Attribution: the quoted customer belongs to the rep (spec §9.5).
    await tx
      .update(customers)
      .set({ assignedSalesId: quote.createdBy })
      .where(eq(customers.id, input.customerId));
    await tx
      .update(quotes)
      .set({ status: "accepted", acceptedOrderId: order.id, customerId: input.customerId })
      .where(eq(quotes.id, input.quoteId));
    if (quote.leadId) {
      const { leads, leadActivities } = await import("@/lib/db/schema");
      await tx
        .update(leads)
        .set({ status: "won", convertedCustomerId: input.customerId })
        .where(eq(leads.id, quote.leadId));
      await tx.insert(leadActivities).values({
        leadId: quote.leadId,
        kind: "status_change",
        body: `Quote ${quote.number} accepted, order ${number}`,
        createdBy: quote.createdBy,
      });
    }

    await writeAudit(tx, {
      actor: null,
      action: "quote.accept",
      entity: "quote",
      entityId: input.quoteId,
      after: { orderId: order.id, orderNumber: number, totalCents },
    });
    await emitDomainEvent(tx, "quote.accepted", {
      quoteId: input.quoteId,
      orderId: order.id,
      createdBy: quote.createdBy,
    });

    return { orderId: order.id, orderNumber: number, totalCents };
  });
}
