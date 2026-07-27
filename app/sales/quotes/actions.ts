"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/auth";
import {
  createQuote,
  sendQuote,
  describeChannels,
  DiscountFloorError,
  QuoteDeliveryError,
} from "@/lib/domain/quotes";
import { draftItemsToInput, type QuoteDraftItem } from "./pricing";

/**
 * `delivered` is the honest bit: a quote can be saved and still not reach the
 * customer. When that happens the action succeeds (the quote exists), returns
 * the share link, and says plainly that nothing was sent.
 */
export type Result = {
  ok: boolean;
  error?: string;
  quoteId?: string;
  /** Only meaningful when the caller asked to send. */
  delivered?: boolean;
  /** What actually happened, in a sentence a rep can act on. */
  message?: string;
  /** Share link, so the rep can always deliver it by hand. */
  link?: string;
};

const fail = (err: unknown): Result => ({
  ok: false,
  error:
    err instanceof DiscountFloorError
      ? err.message
      : err instanceof Error
        ? err.message
        : "Failed",
});

function contactLabel(recipient: {
  name: string | null;
  phone: string | null;
  email: string | null;
}): string {
  return recipient.name ?? recipient.phone ?? recipient.email ?? "the customer";
}

export async function saveQuoteAction(input: {
  leadId?: string;
  customerId?: string;
  items: QuoteDraftItem[];
  send: boolean;
}): Promise<Result> {
  let quoteId: string | undefined;
  try {
    const actor = await requireActor();
    // Integer cents, read from the text the rep typed by the same helper the
    // builder prices with. An amount neither of them can read stops the save
    // here rather than being written to the quote as zero.
    const created = await createQuote(actor, {
      leadId: input.leadId ?? null,
      customerId: input.customerId ?? null,
      items: draftItemsToInput(input.items),
    });
    quoteId = created.quoteId;

    if (!input.send) {
      revalidatePath("/sales/quotes");
      return { ok: true, quoteId, message: "Draft saved" };
    }

    const sent = await sendQuote(actor, created.quoteId);
    revalidatePath("/sales/quotes");
    return {
      ok: true,
      quoteId,
      delivered: true,
      link: sent.link,
      message: `Sent to ${contactLabel(sent.recipient)} by ${describeChannels(sent.channels)}`,
    };
  } catch (err) {
    // The quote was built, only the delivery failed. Keep it, hand back the
    // link, and never claim it went out.
    if (err instanceof QuoteDeliveryError && quoteId) {
      revalidatePath("/sales/quotes");
      return {
        ok: true,
        quoteId,
        delivered: false,
        link: err.link,
        message: `Saved as a draft, but nothing was delivered. ${err.message}`,
      };
    }
    return fail(err);
  }
}

export async function sendQuoteAction(quoteId: string): Promise<Result> {
  try {
    const actor = await requireActor();
    const sent = await sendQuote(actor, quoteId);
    revalidatePath("/sales/quotes");
    revalidatePath(`/sales/quotes/${quoteId}`);
    return {
      ok: true,
      quoteId,
      delivered: true,
      link: sent.link,
      message: `Sent to ${contactLabel(sent.recipient)} by ${describeChannels(sent.channels)}`,
    };
  } catch (err) {
    if (err instanceof QuoteDeliveryError) {
      revalidatePath("/sales/quotes");
      revalidatePath(`/sales/quotes/${quoteId}`);
      return {
        ok: true,
        quoteId,
        delivered: false,
        link: err.link,
        message: err.message,
      };
    }
    return fail(err);
  }
}
