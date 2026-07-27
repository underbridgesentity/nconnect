import type { Metadata } from "next";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { CheckCircle2, Clock, MessageCircle, Phone } from "lucide-react";
import { db } from "@/lib/db/client";
import { orders, orderItems, invoices, payments } from "@/lib/db/schema";
import { getSetting } from "@/lib/domain/settings";
import { add, subtract, type Cents } from "@/lib/money";
import { MoneyText } from "@/components/shared/money-text";
import {
  whatsappHref,
  type CompanySettings,
} from "@/components/public/whatsapp";
import { signInVerifiedCustomerAction } from "../actions";

export const metadata: Metadata = {
  title: "Order received",
  robots: { index: false },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stop refreshing after this long and show a calm, actionable holding state. */
const MAX_POLL_SECONDS = 45;
const POLL_INTERVAL_SECONDS = 4;

const CTA =
  "inline-flex touch-target items-center justify-center rounded-full bg-primary px-8 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 hover:bg-[#0f5a91]";
const CTA_SECONDARY =
  "inline-flex touch-target items-center justify-center rounded-full border px-6 text-sm font-medium hover:bg-accent";

function SupportRoutes({ phone }: { phone: string | null }) {
  if (!phone) return null;
  const wa = `https://wa.me/27${phone.replace(/\D/g, "").replace(/^0/, "")}`;
  return (
    <div className="mt-6 flex flex-wrap justify-center gap-3">
      <a href={wa} className={CTA_SECONDARY}>
        <MessageCircle className="mr-2 size-4" aria-hidden />
        WhatsApp us
      </a>
      <a href={`tel:${phone.replace(/\s/g, "")}`} className={CTA_SECONDARY}>
        <Phone className="mr-2 size-4" aria-hidden />
        {phone}
      </a>
    </div>
  );
}

/**
 * PayFast return URL. The ITN webhook is the source of truth, this page
 * reflects the current status honestly and refreshes until the ITN lands
 * (usually seconds), then stops and hands the customer a way to reach a
 * human rather than spinning forever.
 *
 * `ref` is whatever we sent PayFast as m_payment_id: an order id, or an
 * invoice pay-link id prefixed with "inv:". Anything else renders the
 * not-found branch instead of throwing a database error at someone who has
 * just been charged.
 */
export default async function SignupSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; tries?: string }>;
}) {
  const { ref, tries } = await searchParams;
  const company = await getSetting<{ phone: string }>("company");
  const supportPhone = company?.phone ?? null;

  const attempt = Number.isFinite(Number(tries)) ? Math.max(0, Number(tries)) : 0;
  const elapsed = attempt * POLL_INTERVAL_SECONDS;
  const keepPolling = elapsed < MAX_POLL_SECONDS;

  const invoiceRef = ref?.startsWith("inv:")
    ? ref.slice(4).split(":")[0]
    : null;

  // ------------------------------------------------- invoice pay-link return
  if (invoiceRef) {
    const invoice = UUID_RE.test(invoiceRef)
      ? (
          await db
            .select()
            .from(invoices)
            .where(eq(invoices.id, invoiceRef))
            .limit(1)
        )[0]
      : undefined;
    if (!invoice) return <NotFound supportPhone={supportPhone} />;

    // The invoice total is not what was just paid. Part-payments are supported
    // and leave the invoice open, so quoting the total here would overstate the
    // charge to somebody who only settled a balance. Show what is confirmed
    // received against the invoice and what is left.
    const received = await db
      .select({ amountCents: payments.amountCents })
      .from(payments)
      .where(
        and(eq(payments.invoiceId, invoice.id), eq(payments.status, "complete"))
      );
    const paidCents: Cents = received.reduce(
      (sum, p) => add(sum, p.amountCents),
      0
    );
    const balanceCents = subtract(invoice.totalCents, paidCents);

    const settled = invoice.status === "paid" || balanceCents <= 0;
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        {!settled && keepPolling ? (
          <meta
            httpEquiv="refresh"
            content={`${POLL_INTERVAL_SECONDS};url=/signup/success?ref=inv:${invoice.id}&tries=${attempt + 1}`}
          />
        ) : null}
        {settled ? (
          <CheckCircle2 className="mx-auto size-10 text-emerald-600" aria-hidden />
        ) : (
          <Clock className="mx-auto size-10 text-primary" aria-hidden />
        )}
        <h1 className="mt-4 text-2xl font-semibold">
          {settled
            ? "Payment received, thank you."
            : "Confirming your payment..."}
        </h1>
        <p className="mt-2 text-muted-foreground">
          Invoice <span className="font-mono">{invoice.number}</span>.{" "}
          {settled
            ? "Nothing further is due on it."
            : keepPolling
              ? "PayFast is confirming with us, this page updates itself."
              : "We are still waiting on PayFast's confirmation, which occasionally takes a few minutes. Nothing is lost, and we will message you the moment it clears."}
        </p>
        <dl className="mx-auto mt-6 max-w-xs overflow-hidden rounded-2xl border bg-card text-left text-sm">
          <div className="flex items-center justify-between gap-3 border-b p-3">
            <dt className="text-muted-foreground">Invoice total</dt>
            <dd>
              <MoneyText cents={invoice.totalCents} />
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3 border-b p-3">
            <dt className="text-muted-foreground">Confirmed received</dt>
            <dd>
              <MoneyText cents={paidCents} />
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3 bg-muted/40 p-3 font-semibold">
            <dt>{balanceCents > 0 ? "Balance remaining" : "Nothing due"}</dt>
            <dd>
              <MoneyText cents={Math.max(0, balanceCents)} />
            </dd>
          </div>
        </dl>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/portal/billing" className={CTA}>
            Open your billing
          </Link>
          {!settled && !keepPolling ? (
            <Link
              href={`/signup/success?ref=inv:${invoice.id}&tries=0`}
              className={CTA_SECONDARY}
            >
              Check again
            </Link>
          ) : null}
        </div>
        {!settled ? <SupportRoutes phone={supportPhone} /> : null}
      </div>
    );
  }

  // ------------------------------------------------------- signup order return
  const order =
    ref && UUID_RE.test(ref)
      ? (await db.select().from(orders).where(eq(orders.id, ref)).limit(1))[0]
      : undefined;

  if (!order) return <NotFound supportPhone={supportPhone} />;

  const paid = order.status !== "pending_payment";
  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id));
  const hasHardware = items.some((i) => i.itemType === "hardware");

  if (!paid) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        {keepPolling ? (
          <meta
            httpEquiv="refresh"
            content={`${POLL_INTERVAL_SECONDS};url=/signup/success?ref=${order.id}&tries=${attempt + 1}`}
          />
        ) : null}
        <Clock className="mx-auto size-10 text-primary" aria-hidden />
        <h1 className="mt-4 text-2xl font-semibold">
          {keepPolling
            ? "Confirming your payment..."
            : "Still waiting on PayFast"}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {keepPolling ? (
            <>
              PayFast is confirming order{" "}
              <span className="font-mono">{order.number}</span>. This page
              updates itself, usually within seconds.
            </>
          ) : (
            <>
              Your payment went through at PayFast. We are still waiting on
              their confirmation, which occasionally takes a few minutes. Order{" "}
              <span className="font-mono">{order.number}</span> is safe, and we
              will WhatsApp you the moment it clears.
            </>
          )}
        </p>
        {!keepPolling ? (
          <>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href={`/signup/success?ref=${order.id}&tries=0`}
                className={CTA}
              >
                Check again
              </Link>
            </div>
            <SupportRoutes phone={supportPhone} />
            <p className="mt-4 text-xs text-muted-foreground">
              Quote order {order.number} and we will find it straight away.
            </p>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <div className="text-center">
        <CheckCircle2 className="mx-auto size-10 text-emerald-600" aria-hidden />
        <h1 className="mt-4 text-2xl font-semibold">
          Payment received, you&apos;re in.
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Order <span className="font-mono">{order.number}</span>,{" "}
          <MoneyText cents={order.totalCents} />
        </p>
        <div className="mx-auto mt-6 max-w-sm space-y-3 text-left text-sm text-muted-foreground">
          <p>
            <span className="font-semibold text-foreground">1.</span> We verify
            your details{" "}
            {order.channel === "web" ? "(RICA for SIM services)" : ""} and
            prepare your order.
          </p>
          {hasHardware ? (
            <p>
              <span className="font-semibold text-foreground">2.</span> We
              confirm your hardware delivery date with you, then ship it.
            </p>
          ) : null}
          <p>
            <span className="font-semibold text-foreground">
              {hasHardware ? "3." : "2."}
            </span>{" "}
            We activate your service and WhatsApp you the moment it&apos;s
            live, your paid month starts then.
          </p>
        </div>
        <form action={signInVerifiedCustomerAction} className="mt-8">
          <button type="submit" className={CTA}>
            Open your portal
          </button>
        </form>
        <SupportRoutes phone={supportPhone} />
      </div>
    </div>
  );
}

function NotFound({ supportPhone }: { supportPhone: string | null }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">We couldn&apos;t find that order</h1>
      <p className="mt-2 text-muted-foreground">
        If you have just paid, nothing is lost. Give it a minute and check your
        portal, or contact us with the amount and the time and we will find it
        immediately.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/login" className={CTA}>
          Sign in to your portal
        </Link>
      </div>
      <SupportRoutes phone={supportPhone} />
    </div>
  );
}
