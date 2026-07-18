import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { CheckCircle2, Clock } from "lucide-react";
import { db } from "@/lib/db/client";
import { orders } from "@/lib/db/schema";
import { signInVerifiedCustomerAction } from "../actions";

export const metadata: Metadata = {
  title: "Order received",
  robots: { index: false },
};

/**
 * PayFast return URL. The ITN webhook is the source of truth — this page
 * reflects the order's current status honestly and refreshes until the ITN
 * lands (usually seconds).
 */
export default async function SignupSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;
  const order = ref
    ? (await db.select().from(orders).where(eq(orders.id, ref)).limit(1))[0]
    : null;

  if (!order) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">We couldn&apos;t find that order</h1>
        <p className="mt-2 text-muted-foreground">
          If you&apos;ve just paid, give it a minute — or contact us and
          we&apos;ll check immediately.
        </p>
      </div>
    );
  }

  const paid = order.status !== "pending_payment";

  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      {!paid ? (
        <>
          <meta httpEquiv="refresh" content="4" />
          <div className="text-center">
            <Clock className="mx-auto size-10 text-primary" aria-hidden />
            <h1 className="mt-4 text-2xl font-semibold">
              Confirming your payment…
            </h1>
            <p className="mt-2 text-muted-foreground">
              PayFast is confirming order {order.number}. This page updates
              itself — usually within seconds.
            </p>
          </div>
        </>
      ) : (
        <div className="text-center">
          <CheckCircle2 className="mx-auto size-10 text-emerald-600" aria-hidden />
          <h1 className="mt-4 text-2xl font-semibold">
            Payment received — you&apos;re in.
          </h1>
          <div className="mx-auto mt-6 max-w-sm space-y-3 text-left text-sm text-muted-foreground">
            <p>
              <span className="font-semibold text-foreground">1.</span> We
              verify your details{" "}
              {order.channel === "web" ? "(RICA for SIM services)" : ""} and
              prepare your order.
            </p>
            <p>
              <span className="font-semibold text-foreground">2.</span> Hardware
              (if ordered) is delivered within 3 business days.
            </p>
            <p>
              <span className="font-semibold text-foreground">3.</span> We
              activate your service and WhatsApp you the moment it&apos;s live —
              your paid month starts then.
            </p>
          </div>
          <form action={signInVerifiedCustomerAction} className="mt-8">
            <button
              type="submit"
              className="mx-auto flex touch-target items-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Open your portal
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
