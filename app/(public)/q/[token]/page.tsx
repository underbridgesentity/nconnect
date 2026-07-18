import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { quotes } from "@/lib/db/schema";

export const metadata: Metadata = {
  title: "Your quote",
  robots: { index: false, follow: false },
};

/**
 * Public quote link (spec §9.1). Quotes are created by the sales workspace
 * (milestone M7); until then any token 404s honestly. The route exists so
 * share links have a stable home from day one.
 */
export default async function QuotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [quote] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.shareToken, token))
    .limit(1);
  if (!quote) notFound();

  // Full rendering (line items, viewed tracking, accept flow) lands with M7.
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">
        Quote {quote.number}
      </h1>
      <p className="mt-2 text-muted-foreground">
        This quote link is valid. The interactive quote view is being finished
        — your rep will walk you through the line items in the meantime.
      </p>
    </div>
  );
}
