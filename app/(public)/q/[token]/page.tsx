import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { quoteByToken } from "@/lib/domain/quotes";
import { MoneyText } from "@/components/shared/money-text";

export const metadata: Metadata = {
  title: "Your quote",
  robots: { index: false, follow: false },
};

/**
 * Public quote link (spec §9.1): renders line items, totals and validity;
 * marks `viewed`; the accept button enters checkout with pricing locked to
 * the quote snapshots.
 */
export default async function QuotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await quoteByToken(token);
  if (!result) notFound();
  const { quote, items, expired } = result;

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <p className="text-sm text-muted-foreground">Your Needd Connect quote</p>
      <h1 className="text-2xl font-semibold tracking-tight">{quote.number}</h1>

      <div className="mt-6 rounded-lg border bg-card">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-start justify-between gap-3 border-b p-3 text-sm last:border-0"
          >
            <span>
              {item.nameSnapshot}
              {item.qty > 1 ? ` × ${item.qty}` : ""}
              {item.discountCents > 0 ? (
                <span className="block text-xs text-emerald-700">
                  includes <MoneyText cents={item.discountCents} /> discount
                </span>
              ) : null}
            </span>
            <MoneyText
              cents={(item.unitPriceCentsSnapshot - item.discountCents) * item.qty}
            />
          </div>
        ))}
        <div className="flex items-center justify-between p-3 font-semibold">
          <span>Total due on acceptance</span>
          <MoneyText cents={quote.totalCents} />
        </div>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {expired
          ? "This quote has expired — message your rep for a refreshed one; prices may have changed."
          : quote.expiresAt
            ? `Valid until ${quote.expiresAt.toISOString().slice(0, 10)}. Prices are locked for you until then.`
            : ""}
      </p>

      {quote.status === "accepted" ? (
        <p className="mt-6 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <Check className="size-4" aria-hidden />
          Accepted — your order is in. We&apos;ll take it from here.
        </p>
      ) : expired ? null : (
        <Link
          href={`/q/${token}/accept`}
          className="mt-6 flex touch-target items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Accept &amp; pay securely
        </Link>
      )}
      <p className="mt-3 text-center text-xs text-muted-foreground">
        Questions? Reply to your rep on WhatsApp — the quote stays exactly as
        shown.
      </p>
    </div>
  );
}
