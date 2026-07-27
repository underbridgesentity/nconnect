import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { payments, orders, paymentMethods } from "@/lib/db/schema";
import {
  verifyItnSignature,
  verifyItnSourceIp,
  confirmItnWithPayfast,
} from "@/lib/payfast";
import { markOrderPaid } from "@/lib/domain/orders";
import { createServicesForPaidOrder } from "@/lib/domain/services";
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

  // 4. Idempotency: has this gateway ref been processed?
  const [existing] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.gatewayRef, pfPaymentId))
    .limit(1);
  if (existing) {
    return new NextResponse("OK (already processed)", { status: 200 });
  }

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
    // is left for manual reconciliation rather than being booked at a guess.
    return new NextResponse("OK", { status: 200 });
  }

  // Invoice pay-link payments carry an "inv:" prefix (§6.2).
  if (mPaymentId.startsWith("inv:")) {
    const invoiceId = mPaymentId.slice(4).split(":")[0];
    try {
      const { markInvoicePaidFromGateway } = await import(
        "@/lib/domain/billing-engine"
      );
      await markInvoicePaidFromGateway({
        invoiceId,
        gatewayRef: pfPaymentId,
        amountCents,
        method: "payfast_card",
      });
      return new NextResponse("OK", { status: 200 });
    } catch (err) {
      console.error("invoice itn processing failed:", err);
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

    if (!result.alreadyPaid) {
      // Spec §5: paid order -> pending services -> auto-provisioning.
      try {
        await createServicesForPaidOrder(mPaymentId);
      } catch (err) {
        console.error("service creation after payment failed:", err);
      }

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

    return new NextResponse("OK", { status: 200 });
  } catch (err) {
    console.error("payfast itn processing failed:", err);
    // 500 so PayFast retries, the idempotency guard makes retries safe.
    return new NextResponse("Processing error", { status: 500 });
  }
}
