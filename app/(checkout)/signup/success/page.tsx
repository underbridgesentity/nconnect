import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { CheckCircle2, Clock, MessageCircle, Phone, Undo2 } from "lucide-react";
import { db } from "@/lib/db/client";
import { orders, orderItems, invoices, payments } from "@/lib/db/schema";
import { getSetting } from "@/lib/domain/settings";
import { add, subtract, type Cents } from "@/lib/money";
import { MoneyText } from "@/components/shared/money-text";
import {
  whatsappHref,
  type CompanySettings,
} from "@/components/public/whatsapp";
import { PillButton, PillLink } from "@/components/public/pill";
import { signInVerifiedCustomerAction } from "../actions";

export const metadata: Metadata = {
  // Neutral, because this one page also renders the cancelled and the
  // still-confirming outcomes and the tab should not announce a result the
  // page below it does not support.
  title: "Your order",
  robots: { index: false },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stop refreshing after this long and show a calm, actionable holding state. */
const MAX_POLL_SECONDS = 45;
const POLL_INTERVAL_SECONDS = 4;

/**
 * Ways to reach a person, offered only where they actually work. The company
 * switchboard is an 086 share-call number and wa.me cannot resolve one, so the
 * WhatsApp button is drawn from whatsappHref and simply is not there until
 * settings carry a real mobile. Somebody who has just been charged deserves a
 * route that opens, not one that reports an invalid number.
 */
function SupportRoutes({ company }: { company: CompanySettings | null }) {
  const phone = company?.phone ?? null;
  const wa = whatsappHref(
    company,
    "Hi Needd Connect, I have just paid and need a hand with my order."
  );
  if (!wa && !phone) return null;
  return (
    <div className="mt-6 flex flex-wrap justify-center gap-3">
      {wa ? (
        <PillLink href={wa} target="_blank" rel="noreferrer" variant="outline">
          <MessageCircle className="size-4" aria-hidden />
          WhatsApp us
        </PillLink>
      ) : null}
      {phone ? (
        <PillLink href={`tel:${phone.replace(/\s/g, "")}`} variant="outline">
          <Phone className="size-4" aria-hidden />
          {phone}
        </PillLink>
      ) : null}
    </div>
  );
}

type OrderStatus = (typeof orders.$inferSelect)["status"];

/**
 * What this page is allowed to tell the customer, with every value of the
 * order status enum written out.
 *
 * It used to read `paid = status !== "pending_payment"`, which quietly turned
 * a cancelled order into a receipt: `cancelStaleOrder` retires the pending
 * order whenever somebody edits their basket or address at review, so anyone
 * who then reopened the old return URL was told their payment had gone
 * through when not a cent had moved. A new status has to be handled here
 * before this file compiles.
 */
type OrderView =
  | { kind: "awaiting" }
  | { kind: "received"; stage: "paid" | "processing" | "fulfilled" }
  | { kind: "cancelled" };

function describeOrder(status: OrderStatus): OrderView {
  switch (status) {
    case "pending_payment":
      return { kind: "awaiting" };
    case "paid":
      return { kind: "received", stage: "paid" };
    case "processing":
      return { kind: "received", stage: "processing" };
    case "fulfilled":
      return { kind: "received", stage: "fulfilled" };
    case "cancelled":
      return { kind: "cancelled" };
  }
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
  const company = await getSetting<CompanySettings>("company");

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
    if (!invoice) return <NotFound company={company} />;

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
          <PillLink href="/portal/billing" size="lg">
            Open your billing
          </PillLink>
          {!settled && !keepPolling ? (
            <PillLink
              href={`/signup/success?ref=inv:${invoice.id}&tries=0`}
              variant="outline"
            >
              Check again
            </PillLink>
          ) : null}
        </div>
        {!settled ? <SupportRoutes company={company} /> : null}
      </div>
    );
  }

  // ------------------------------------------------------- signup order return
  const order =
    ref && UUID_RE.test(ref)
      ? (await db.select().from(orders).where(eq(orders.id, ref)).limit(1))[0]
      : undefined;

  if (!order) return <NotFound company={company} />;

  const view = describeOrder(order.status);

  if (view.kind === "cancelled") {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <Undo2 className="mx-auto size-10 text-muted-foreground" aria-hidden />
        <h1 className="mt-4 text-2xl font-semibold">
          Order <span className="font-mono">{order.number}</span> was cancelled
        </h1>
        <p className="mt-2 text-muted-foreground">
          Nothing was charged against it. An order is cancelled here when the
          basket or the delivery address changed after review, in which case a
          newer order took its place and that is the one to follow.
        </p>
        <p className="mt-3 text-muted-foreground">
          If money did leave your account, nothing is lost. Tell us the amount
          and roughly what time, and we will trace it the same day.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <PillLink href="/login" size="lg">
            Sign in to your portal
          </PillLink>
          <PillLink href="/internet" variant="outline">
            Start again
          </PillLink>
        </div>
        <SupportRoutes company={company} />
      </div>
    );
  }

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id));
  const hasHardware = items.some((i) => i.itemType === "hardware");

  if (view.kind === "awaiting") {
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
              Being back here does not on its own tell us whether the payment
              went through, and PayFast&apos;s confirmation has not reached us
              yet. That occasionally takes a few minutes. Order{" "}
              <span className="font-mono">{order.number}</span> is safe either
              way, and we will WhatsApp you the moment it clears.
            </>
          )}
        </p>
        {!keepPolling ? (
          <>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <PillLink
                href={`/signup/success?ref=${order.id}&tries=0`}
                size="lg"
              >
                Check again
              </PillLink>
            </div>
            <SupportRoutes company={company} />
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
          {view.stage === "fulfilled"
            ? "This order is complete."
            : view.stage === "processing"
              ? "Payment received, your order is under way."
              : "Payment received, you're in."}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Order <span className="font-mono">{order.number}</span>,{" "}
          <MoneyText cents={order.totalCents} />
        </p>
        {/*
          The steps are what happens next, so they are only shown while they
          are still ahead of the customer. Somebody reopening this link a week
          later, with the order already worked through, gets told where things
          actually stand instead of a plan that has already happened.
        */}
        {view.stage === "paid" ? (
          <div className="mx-auto mt-6 max-w-sm space-y-3 text-left text-sm text-muted-foreground">
            <p>
              <span className="font-semibold text-foreground">1.</span> We
              verify your details{" "}
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
        ) : (
          <p className="mx-auto mt-6 max-w-sm text-sm text-muted-foreground">
            {view.stage === "processing"
              ? "We are preparing it now and will WhatsApp you at every step. Your portal has the current status."
              : "Everything about your service and your invoices now lives in your portal."}
          </p>
        )}
        <form action={signInVerifiedCustomerAction} className="mt-8">
          <PillButton type="submit" size="lg">
            Open your portal
          </PillButton>
        </form>
        <SupportRoutes company={company} />
      </div>
    </div>
  );
}

function NotFound({ company }: { company: CompanySettings | null }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">We couldn&apos;t find that order</h1>
      <p className="mt-2 text-muted-foreground">
        If you have just paid, nothing is lost. Give it a minute and check your
        portal, or contact us with the amount and the time and we will find it
        immediately.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <PillLink href="/login" size="lg">
          Sign in to your portal
        </PillLink>
      </div>
      <SupportRoutes company={company} />
    </div>
  );
}
