"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/auth";
import { createQuote, sendQuote, DiscountFloorError } from "@/lib/domain/quotes";

export type Result = { ok: boolean; error?: string; quoteId?: string };
const fail = (err: unknown): Result => ({
  ok: false,
  error:
    err instanceof DiscountFloorError
      ? err.message
      : err instanceof Error
        ? err.message
        : "Failed",
});

export interface QuoteDraftItem {
  itemType: "plan" | "hardware" | "bundle" | "custom";
  planId?: string;
  hardwareId?: string;
  bundleId?: string;
  customName?: string;
  customPriceRands?: number;
  discountRands?: number;
  qty: number;
}

export async function saveQuoteAction(input: {
  leadId?: string;
  customerId?: string;
  items: QuoteDraftItem[];
  send: boolean;
}): Promise<Result> {
  try {
    const actor = await requireActor();
    const { quoteId } = await createQuote(actor, {
      leadId: input.leadId ?? null,
      customerId: input.customerId ?? null,
      items: input.items.map((i) => ({
        itemType: i.itemType,
        planId: i.planId ?? null,
        hardwareId: i.hardwareId ?? null,
        bundleId: i.bundleId ?? null,
        customName: i.customName ?? null,
        customPriceCents:
          i.customPriceRands != null
            ? Math.round(i.customPriceRands * 100)
            : null,
        discountCents: Math.round((i.discountRands ?? 0) * 100),
        qty: i.qty,
      })),
    });
    if (input.send) {
      await sendQuote(actor, quoteId);
    }
    revalidatePath("/sales/quotes");
    return { ok: true, quoteId };
  } catch (err) {
    return fail(err);
  }
}

export async function sendQuoteAction(quoteId: string): Promise<Result> {
  try {
    const actor = await requireActor();
    await sendQuote(actor, quoteId);
    revalidatePath("/sales/quotes");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
