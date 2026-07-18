import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { quoteByToken } from "@/lib/domain/quotes";
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
  if (!result || result.expired || result.quote.acceptedOrderId) notFound();
  const prefill = await acceptPrefill(token);
  if (!prefill) notFound();

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">
        Accept quote {result.quote.number}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Three quick steps: verify your number, your address, secure payment.
        Pricing stays exactly as quoted.
      </p>
      <div className="mt-6">
        <AcceptFlow
          token={token}
          prefill={prefill}
          totalCents={result.quote.totalCents}
        />
      </div>
    </div>
  );
}
