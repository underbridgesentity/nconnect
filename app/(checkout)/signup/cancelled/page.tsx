import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { CreditCard, Landmark, MessageCircle } from "lucide-react";
import { db } from "@/lib/db/client";
import { orders, orderItems, invoices } from "@/lib/db/schema";
import { getSetting } from "@/lib/domain/settings";
import { multiply } from "@/lib/money";
import { MoneyText } from "@/components/shared/money-text";
import {
  whatsappHref,
  type CompanySettings,
} from "@/components/public/whatsapp";

export const metadata: Metadata = {
  title: "Payment cancelled",
  robots: { index: false },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CTA =
  "inline-flex touch-target items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 hover:bg-[#0f5a91]";
const CTA_SECONDARY =
  "inline-flex touch-target items-center justify-center rounded-full border px-6 text-sm font-medium hover:bg-accent";

type Banking = {
  bank: string;
  accountName: string;
  accountNumber: string;
  branchCode: string;
};

/** Only publish banking details once they are real (spec §14). */
function bankingIsPublishable(b: Banking | null): b is Banking {
  if (!b) return false;
  return [b.bank, b.accountName, b.accountNumber, b.branchCode].every(
    (v) => typeof v === "string" && v.trim() !== "" && !/tbc/i.test(v)
  );
}

/**
 * PayFast cancel URL. The order is still pending_payment, which makes this
 * the warmest lead in the funnel: show exactly what was not paid for and
 * every honest way to finish it.
 */
export default async function SignupCancelledPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;
  const [company, banking] = await Promise.all([
    getSetting<CompanySettings>("company"),
    getSetting<Banking>("banking"),
  ]);
  // wa.me cannot deliver to the 086 switchboard, so the button only appears
  // once settings carry a real mobile. A dead link here loses the warmest
  // lead in the funnel.
  const wa = whatsappHref(
    company,
    "Hi Needd Connect, my card payment did not go through and I would like to finish my order."
  );

  const invoiceRef = ref?.startsWith("inv:") ? ref.slice(4).split(":")[0] : null;
  const invoice =
    invoiceRef && UUID_RE.test(invoiceRef)
      ? (
          await db
            .select()
            .from(invoices)
            .where(eq(invoices.id, invoiceRef))
            .limit(1)
        )[0]
      : undefined;

  const order =
    !invoiceRef && ref && UUID_RE.test(ref)
      ? (await db.select().from(orders).where(eq(orders.id, ref)).limit(1))[0]
      : undefined;
  const items = order
    ? await db
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, order.id))
    : [];

  const reference = invoice?.number ?? order?.number ?? null;
  const amountCents = invoice?.totalCents ?? order?.totalCents ?? null;

  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">No payment was taken</h1>
        <p className="mt-2 text-muted-foreground">
          {reference ? (
            <>
              Nothing was charged and{" "}
              {invoice ? "invoice" : "order"}{" "}
              <span className="font-mono">{reference}</span> is saved exactly as
              you left it.
            </>
          ) : (
            <>
              Nothing was charged and your order is saved exactly as you left
              it.
            </>
          )}
        </p>
      </div>

      {order && items.length > 0 ? (
        <div className="mt-6 overflow-hidden rounded-2xl border bg-card">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between border-b p-3 text-sm last:border-0"
            >
              <span>
                {item.nameSnapshot}
                {item.qty > 1 ? ` × ${item.qty}` : ""}
              </span>
              <MoneyText
                cents={multiply(item.unitPriceCentsSnapshot, item.qty)}
              />
            </div>
          ))}
          <div className="flex items-center justify-between border-t bg-muted/40 p-3 font-semibold">
            <span>Still to pay</span>
            <MoneyText cents={order.totalCents} />
          </div>
        </div>
      ) : amountCents !== null ? (
        <p className="mt-6 rounded-2xl border bg-card p-4 text-center text-sm">
          <span className="text-muted-foreground">Still to pay: </span>
          <MoneyText cents={amountCents} className="font-semibold" />
        </p>
      ) : null}

      <div className="mt-8 space-y-3">
        <h2 className="text-sm font-semibold">Three ways to finish this</h2>
        <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
          <div className="flex items-start gap-3">
            <CreditCard className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <div>
              <p className="text-sm font-medium">Try the card again</p>
              <p className="text-sm text-muted-foreground">
                Cards are usually declined for one of three reasons: 3D Secure
                was not completed in your banking app, the online or daily
                limit was reached, or the card is blocked for online purchases.
                All three are fixed in your banking app in under a minute.
              </p>
              <Link
                href={invoice ? "/portal/billing" : "/signup?step=3"}
                className={`mt-3 ${CTA}`}
              >
                {invoice ? "Pay from your portal" : "Try again"}
              </Link>
            </div>
          </div>
        </div>

        {bankingIsPublishable(banking) ? (
          <div className="rounded-2xl border bg-card p-4">
            <div className="flex items-start gap-3">
              <Landmark className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <div>
                <p className="text-sm font-medium">Pay by EFT</p>
                <p className="text-sm text-muted-foreground">
                  Use your bank app and send us the proof, we start the moment
                  it reflects.
                </p>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Bank</dt>
                  <dd>{banking.bank}</dd>
                  <dt className="text-muted-foreground">Account name</dt>
                  <dd>{banking.accountName}</dd>
                  <dt className="text-muted-foreground">Account number</dt>
                  <dd className="font-mono">{banking.accountNumber}</dd>
                  <dt className="text-muted-foreground">Branch code</dt>
                  <dd className="font-mono">{banking.branchCode}</dd>
                  {reference ? (
                    <>
                      <dt className="text-muted-foreground">Reference</dt>
                      <dd className="font-mono">{reference}</dd>
                    </>
                  ) : null}
                </dl>
              </div>
            </div>
          </div>
        ) : null}

        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-start gap-3">
            <MessageCircle className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <div>
              <p className="text-sm font-medium">Let us take it from here</p>
              <p className="text-sm text-muted-foreground">
                Message us{reference ? ` with ${reference}` : ""} and a person
                will finish the order with you, including EFT details if you
                prefer that.
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                {wa ? (
                  <a href={wa} className={CTA_SECONDARY}>
                    WhatsApp us
                  </a>
                ) : null}
                <Link href="/contact" className={CTA_SECONDARY}>
                  Talk to us
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
