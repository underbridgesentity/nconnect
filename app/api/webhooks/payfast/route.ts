import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { payments, orders, paymentMethods } from "@/lib/db/schema";
import {
  verifyItnSignature,
  verifyItnSourceIp,
  confirmItnWithPayfast,
} from "@/lib/payfast";
import {
  markOrderPaid,
  provisionPaidOrder,
  recordUnbankablePayment,
  UnprocessablePayment,
} from "@/lib/domain/orders";
import { notify } from "@/lib/notify";
import { renderInvoicePdf } from "@/lib/pdf/invoice";
import { absoluteUrl } from "@/lib/config";
import { parseZar } from "@/lib/money";

/**
 * PayFast ITN webhook (spec §6.2): the only source of truth for payment
 * status. Verify signature + source IP (+ server-to-server validation in
 * live mode), enforce idempotency on the gateway ref, confirm the amount,
 * then process. Always answer 200 once verified so PayFast stops retrying.
 */
/** Any uuid shape, whatever version generated it. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const params = new URLSearchParams(rawBody);

  // 1. Signature
  if (!verifyItnSignature(params)) {
    console.error("payfast itn: bad signature");
    return new NextResponse("Bad signature", { status: 400 });
  }

  // 2. Source IP
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  if (!(await verifyItnSourceIp(ip))) {
    console.error(`payfast itn: bad source ip ${ip}`);
    return new NextResponse("Bad source", { status: 400 });
  }

  // 3. Server-to-server confirmation (live mode; sandbox validate endpoint
  //    is unreliable, signature + amount checks still hold there).
  if (process.env.PAYFAST_MODE === "live") {
    const confirmed = await confirmItnWithPayfast(rawBody);
    if (!confirmed) {
      console.error("payfast itn: server-to-server validation failed");
      return new NextResponse("Validation failed", { status: 400 });
    }
  }

  const paymentStatus = params.get("payment_status");
  const mPaymentId = params.get("m_payment_id"); // our order id
  const pfPaymentId = params.get("pf_payment_id"); // gateway ref
  const amountGross = params.get("amount_gross");
  const token = params.get("token");

  if (!mPaymentId || !pfPaymentId) {
    return new NextResponse("Missing identifiers", { status: 400 });
  }

  // 4. Idempotency: has this gateway ref been processed? Both settlement
  //    paths key on it themselves, so this read only decides how much work to
  //    repeat. The order path deliberately still runs a replayed ITN through
  //    `markOrderPaid`: it writes nothing for a ref already banked, and the
  //    replay is the one automatic second chance a paid order whose services
  //    failed to create ever gets.
  const [existing] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.gatewayRef, pfPaymentId))
    .limit(1);
  const alreadyBanked = Boolean(existing);

  if (paymentStatus !== "COMPLETE") {
    // CANCELLED / FAILED, nothing to mutate for checkout flows; the order
    // stays pending_payment and the customer can retry.
    console.log(`payfast itn: status ${paymentStatus} for ${mPaymentId}`);
    return new NextResponse("OK", { status: 200 });
  }

  // House rule: never float-parse money. PayFast sends amount_gross as a
  // decimal string, and parseFloat(x) * 100 rounds through a binary double on
  // the one number that must be exact, the amount actually charged.
  let amountCents: number;
  try {
    amountCents = parseZar(amountGross ?? "0");
  } catch {
    console.error(
      `payfast itn: unreadable amount_gross "${amountGross}" for ${mPaymentId}`
    );
    // 200 so PayFast stops retrying a payload we can never parse; the payment
    // is booked at no guess at all. It is raised for a person instead, because
    // a debit nobody is told about is the same as a debit nobody records.
    if (!alreadyBanked) {
      await recordUnbankablePayment({
        gatewayRef: pfPaymentId,
        amountCents: 0,
        reference: mPaymentId,
        detail: `PayFast sent an amount we cannot read: "${amountGross ?? ""}"`,
      });
    }
    return new NextResponse("OK", { status: 200 });
  }

  // Invoice pay-link payments carry an "inv:" prefix (§6.2).
  if (mPaymentId.startsWith("inv:")) {
    if (alreadyBanked) {
      return new NextResponse("OK (already processed)", { status: 200 });
    }
    const invoiceId = mPaymentId.slice(4).split(":")[0];
    if (!UUID_PATTERN.test(invoiceId)) {
      // Malformed: the database would raise on the id itself, and every retry
      // would raise identically. Record the debit for a person and stop.
      console.error(
        `PAYMENT NOT BANKABLE: m_payment_id=${mPaymentId} ` +
          `pf_payment_id=${pfPaymentId} amountCents=${amountCents}`
      );
      await recordUnbankablePayment({
        gatewayRef: pfPaymentId,
        amountCents,
        reference: `invoice ${invoiceId}`,
        detail: `"${invoiceId}" is not an invoice reference this system issued`,
      });
      return new NextResponse("OK (recorded for manual handling)", {
        status: 200,
      });
    }
    try {
      const { markInvoicePaidFromGateway } = await import(
        "@/lib/domain/billing-engine"
      );
      const result = await markInvoicePaidFromGateway({
        invoiceId,
        gatewayRef: pfPaymentId,
        amountCents,
        method: "payfast_card",
      });
      if (result.unallocatedCents > 0) {
        // Banked, but the invoice could not absorb it. An operator has a bell
        // and a domain event; this line is for whoever is tailing the logs.
        console.warn(
          `payfast itn: ${result.unallocatedCents} cents of ${amountCents} on ` +
            `${pfPaymentId} could not be applied to invoice ${invoiceId}`
        );
      }
      return new NextResponse("OK", { status: 200 });
    } catch (err) {
      // The customer has been debited and we could not write it down. Log
      // every identifier needed to reconcile it by hand, then answer 500 so
      // PayFast retries: the gateway ref makes retries idempotent, so a
      // transient database fault still ends with the money recorded.
      console.error(
        `PAYMENT NOT RECORDED: invoice=${invoiceId} pf_payment_id=${pfPaymentId} ` +
          `amountCents=${amountCents} m_payment_id=${mPaymentId}:`,
        err
      );
      return new NextResponse("Processing error", { status: 500 });
    }
  }

  try {
    const result = await markOrderPaid({
      orderId: mPaymentId,
      gatewayRef: pfPaymentId,
      amountCents,
      method: "payfast_card",
    });

    if (result.unallocatedCents > 0) {
      // Banked, but the order could not absorb it. An operator has a bell, an
      // audit row and a queue entry; this line is for whoever tails the logs.
      console.warn(
        `payfast itn: ${result.unallocatedCents} cents of ${amountCents} on ` +
          `${pfPaymentId} could not be applied to order ${mPaymentId}`
      );
    }

    // Spec §5: paid order -> pending services -> auto-provisioning. Run on
    // every ITN for a paid order, replays included: creating the services is
    // idempotent, and a paid order that has none is exactly the state a repeat
    // should heal. A failure raises an operator task rather than a log line.
    if (result.orderPaid) {
      await provisionPaidOrder(mPaymentId);
    }

    // Everything below runs after the money is committed, so none of it may
    // decide the answer to PayFast: a receipt that fails to send is not a
    // payment we failed to record, and retrying the ITN would not fix it.
    try {
      if (!result.alreadyPaid && result.settled) {
        const [order] = await db
          .select()
          .from(orders)
          .where(eq(orders.id, mPaymentId))
          .limit(1);

        // Tokenisation (spec §6.2): store the card token on first success.
        if (token && order) {
          const [existingToken] = await db
            .select({ id: paymentMethods.id })
            .from(paymentMethods)
            .where(eq(paymentMethods.payfastToken, token))
            .limit(1);
          if (!existingToken) {
            await db.insert(paymentMethods).values({
              customerId: order.customerId,
              payfastToken: token,
              status: "active",
            });
          }
        }

        if (order && result.invoiceId) {
          let pdf: Buffer | undefined;
          try {
            pdf = await renderInvoicePdf(result.invoiceId);
          } catch (err) {
            console.error("invoice pdf render failed:", err);
          }
          await notify("order_created", {
            customerId: order.customerId,
            amountCents: order.totalCents,
            reference: order.number,
            link: absoluteUrl("/portal"),
            attachments: pdf
              ? [{ filename: `${order.number}-invoice.pdf`, content: pdf }]
              : undefined,
          });
        }
      }
    } catch (err) {
      console.error(
        `order confirmation after payment failed: order=${mPaymentId} ` +
          `pf_payment_id=${pfPaymentId}:`,
        err
      );
    }

    return new NextResponse("OK", { status: 200 });
  } catch (err) {
    if (err instanceof UnprocessablePayment) {
      // A permanent condition: an order id PayFast holds that we do not, or an
      // amount where no money moved. Every retry produces this same answer, so
      // asking for one only ends with PayFast giving up and the debit sitting
      // in nobody's records. Answer 200 and put the payment in front of a
      // person instead.
      console.error(
        `PAYMENT NOT BANKABLE: order=${mPaymentId} pf_payment_id=${pfPaymentId} ` +
          `amountCents=${amountCents}:`,
        err
      );
      await recordUnbankablePayment({
        gatewayRef: pfPaymentId,
        amountCents,
        reference: `order ${mPaymentId}`,
        detail: err.message,
      });
      return new NextResponse("OK (recorded for manual handling)", {
        status: 200,
      });
    }
    console.error(
      `PAYMENT NOT RECORDED: order=${mPaymentId} pf_payment_id=${pfPaymentId} ` +
        `amountCents=${amountCents}:`,
      err
    );
    // 500 so PayFast retries, the idempotency guard makes retries safe.
    return new NextResponse("Processing error", { status: 500 });
  }
}
