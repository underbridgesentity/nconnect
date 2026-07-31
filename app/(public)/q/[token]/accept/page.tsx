import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { quoteByToken } from "@/lib/domain/quotes";
import { MoneyText } from "@/components/shared/money-text";
import { acceptPrefill } from "./actions";
import { AcceptFlow } from "./flow";

export const metadata: Metadata = {
  title: "Accept quote",
  robots: { index: false, follow: false },
};

export default async function AcceptQuotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await quoteByToken(token);
  if (!result) notFound();
  // An expired quote, or one that already has an order, belongs on the quote
  // page: that is where the expiry explanation and the resume-payment button
  // live. A 404 here used to be a dead end for a customer whose card declined.
  if (result.expired || result.quote.acceptedOrderId) redirect(`/q/${token}`);

  const prefill = await acceptPrefill(token);
  if (!prefill) redirect(`/q/${token}`);
  const { quote, breakdown } = result;

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">
        Accept quote {quote.number}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Three quick steps: verify your email address, your address, secure
        payment.
        Pricing stays exactly as quoted.
      </p>

      {/* Restating the purchase here matters: the next screen asks for an ID
          number and documents, and nobody should hand those over while looking
          at a page that never says what they are buying. */}
      <section
        className="mt-5 overflow-hidden rounded-2xl border bg-card"
        aria-label="What you are accepting"
      >
        {breakdown.lines.map((line) => (
          <div
            key={line.id}
            className="flex items-start justify-between gap-3 border-b p-3 text-sm last:border-0"
          >
            <span>
              {line.name}
              {line.qty > 1 ? ` × ${line.qty}` : ""}
              {line.monthlyCents != null ? (
                <span className="block text-xs text-muted-foreground">
                  then <MoneyText cents={line.monthlyCents} /> a month
                </span>
              ) : null}
            </span>
            <MoneyText cents={line.payNowCents} />
          </div>
        ))}
        <div className="flex items-center justify-between bg-muted/40 p-3 text-sm font-semibold">
          <span>Due now</span>
          <MoneyText cents={breakdown.payNowCents} />
        </div>
        {breakdown.hasRecurring ? (
          <div className="flex items-center justify-between border-t bg-muted/40 p-3 text-sm">
            <span className="text-muted-foreground">
              Then per month from your second month
            </span>
            <span className="font-medium">
              <MoneyText cents={breakdown.monthlyCents} />
            </span>
          </div>
        ) : null}
      </section>

      <div className="mt-6">
        <AcceptFlow
          token={token}
          prefill={prefill}
          totalCents={quote.totalCents}
        />
      </div>
    </div>
  );
}
