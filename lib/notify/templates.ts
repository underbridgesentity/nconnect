import { formatCents } from "@/lib/money";
import type { NotifyContext } from "./index";

/**
 * Notification templates (spec §8). WhatsApp template names map to
 * pre-approved Meta templates; body copy here is the email/bell rendering
 * and the WhatsApp body parameters.
 */

export type NotifyEvent =
  | "order_created"
  | "service_provisioning"
  | "service_activated"
  | "invoice_issued"
  | "payment_received"
  | "payment_failed"
  | "past_due_warning"
  | "service_suspended"
  | "service_reactivated"
  | "cancellation_scheduled"
  | "service_cancelled"
  | "quote_sent"
  | "feasibility_result";

export interface RenderedNotification {
  subject: string;
  text: string;
  html: string;
  whatsappParams?: string[];
  bellTitle?: string;
}

export interface NotifyTemplate {
  toCustomer: boolean;
  email: boolean;
  adminBell: boolean;
  salesBell: boolean;
  whatsappTemplate: string | null;
  render: (ctx: NotifyContext) => RenderedNotification;
}

function wrapHtml(body: string): string {
  return `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#18181b">
  ${body}
  <p style="margin-top:32px;font-size:12px;color:#71717a">Needd Connect — one provider, one bill, local support.<br/>Needd Technology Solutions (Pty) Ltd</p>
</div>`;
}

const R = (cents?: number) => formatCents(cents ?? 0, { whole: true });

export const TEMPLATES: Record<NotifyEvent, NotifyTemplate> = {
  order_created: {
    toCustomer: true,
    email: true,
    adminBell: true,
    salesBell: true,
    whatsappTemplate: "order_confirmed",
    render: (ctx) => ({
      subject: `Order ${ctx.reference ?? ""} confirmed — welcome to Needd Connect`,
      text: `Thanks — we've received your payment of ${R(ctx.amountCents)} for order ${ctx.reference}. We're getting you set up now and will keep you posted every step. Your receipt and invoice are attached.`,
      html: wrapHtml(
        `<h2>Payment received — you're in.</h2>
         <p>Thanks! We've received <strong>${R(ctx.amountCents)}</strong> for order <strong>${ctx.reference}</strong>.</p>
         <p>We're getting your service set up now and will keep you posted — you don't need to do anything.</p>
         <p>Your invoice is attached for your records.</p>`
      ),
      whatsappParams: [ctx.reference ?? "", R(ctx.amountCents)],
      bellTitle: `Order ${ctx.reference} paid — ${R(ctx.amountCents)}`,
    }),
  },
  service_provisioning: {
    toCustomer: true,
    email: false,
    adminBell: false, // lands in the Today task queue instead
    salesBell: false,
    whatsappTemplate: "service_provisioning",
    render: (ctx) => ({
      subject: `We're setting up your ${ctx.serviceName ?? "service"}`,
      text: `We're setting up your ${ctx.serviceName ?? "service"} now. We'll message you the moment it's live.`,
      html: wrapHtml(
        `<p>We're setting up your <strong>${ctx.serviceName ?? "service"}</strong> now. We'll message you the moment it's live.</p>`
      ),
      whatsappParams: [ctx.serviceName ?? "service"],
    }),
  },
  service_activated: {
    toCustomer: true,
    email: true,
    adminBell: true,
    salesBell: true,
    whatsappTemplate: "service_activated",
    render: (ctx) => ({
      subject: `Your ${ctx.serviceName ?? "service"} is live`,
      text: `Your ${ctx.serviceName ?? "service"} is now active. Your next invoice lands a month from today, and you can see everything in your portal: ${ctx.link ?? ""}`,
      html: wrapHtml(
        `<h2>You're online.</h2>
         <p>Your <strong>${ctx.serviceName ?? "service"}</strong> is now active.</p>
         <p>The month you paid at checkout starts today — your next invoice lands a month from now.</p>
         <p><a href="${ctx.link ?? "#"}">Open your portal</a> to see your service, invoices and support.</p>`
      ),
      whatsappParams: [ctx.serviceName ?? "service"],
      bellTitle: `Service activated: ${ctx.serviceName}`,
    }),
  },
  invoice_issued: {
    toCustomer: true,
    email: true,
    adminBell: false,
    salesBell: false,
    whatsappTemplate: "invoice_issued",
    render: (ctx) => ({
      subject: `Invoice ${ctx.reference} — ${R(ctx.amountCents)} due`,
      text: `Your Needd Connect invoice ${ctx.reference} for ${R(ctx.amountCents)} is ready. Pay online: ${ctx.link ?? ""}. The PDF is attached.`,
      html: wrapHtml(
        `<h2>Invoice ${ctx.reference}</h2>
         <p><strong>${R(ctx.amountCents)}</strong> is due within 7 days.</p>
         <p><a href="${ctx.link ?? "#"}">Pay securely online</a> — or use the EFT details on the attached PDF.</p>`
      ),
      whatsappParams: [ctx.reference ?? "", R(ctx.amountCents), ctx.link ?? ""],
    }),
  },
  payment_received: {
    toCustomer: true,
    email: true,
    adminBell: false,
    salesBell: false,
    whatsappTemplate: "payment_received",
    render: (ctx) => ({
      subject: `Payment received — thank you`,
      text: `We've received your payment of ${R(ctx.amountCents)}${ctx.reference ? ` for ${ctx.reference}` : ""}. Receipt attached.`,
      html: wrapHtml(
        `<p>We've received your payment of <strong>${R(ctx.amountCents)}</strong>${ctx.reference ? ` for <strong>${ctx.reference}</strong>` : ""}. Thank you!</p>`
      ),
      whatsappParams: [R(ctx.amountCents)],
    }),
  },
  payment_failed: {
    toCustomer: true,
    email: true,
    adminBell: false,
    salesBell: false,
    whatsappTemplate: "payment_failed",
    render: (ctx) => ({
      subject: `Payment didn't go through — quick fix inside`,
      text: `Your payment of ${R(ctx.amountCents)}${ctx.reference ? ` for ${ctx.reference}` : ""} didn't go through. No stress — pay online here: ${ctx.link ?? ""}`,
      html: wrapHtml(
        `<p>Your payment of <strong>${R(ctx.amountCents)}</strong>${ctx.reference ? ` for <strong>${ctx.reference}</strong>` : ""} didn't go through — it happens.</p>
         <p><a href="${ctx.link ?? "#"}">Pay online in under a minute</a>, or reply to this email if something's off.</p>`
      ),
      whatsappParams: [R(ctx.amountCents), ctx.link ?? ""],
    }),
  },
  past_due_warning: {
    toCustomer: true,
    email: true,
    adminBell: true,
    salesBell: false,
    whatsappTemplate: "past_due_warning",
    render: (ctx) => ({
      subject: `Invoice ${ctx.reference} is overdue — 3 days to avoid suspension`,
      text: `Invoice ${ctx.reference} (${R(ctx.amountCents)}) is now overdue. Pay within 3 days to avoid suspension: ${ctx.link ?? ""}`,
      html: wrapHtml(
        `<p>Invoice <strong>${ctx.reference}</strong> for <strong>${R(ctx.amountCents)}</strong> is overdue.</p>
         <p>Pay within <strong>3 days</strong> to keep your service on: <a href="${ctx.link ?? "#"}">pay now</a>.</p>
         <p>Already paid by EFT? Reply with the proof of payment and we'll match it up.</p>`
      ),
      whatsappParams: [ctx.reference ?? "", R(ctx.amountCents), ctx.link ?? ""],
      bellTitle: `Past due: ${ctx.reference} (${R(ctx.amountCents)})`,
    }),
  },
  service_suspended: {
    toCustomer: true,
    email: true,
    adminBell: true,
    salesBell: true,
    whatsappTemplate: "service_suspended",
    render: (ctx) => ({
      subject: `Your ${ctx.serviceName ?? "service"} has been suspended`,
      text: `Your ${ctx.serviceName ?? "service"} was suspended because invoice ${ctx.reference} is unpaid. Pay now and it reactivates automatically: ${ctx.link ?? ""}`,
      html: wrapHtml(
        `<p>Your <strong>${ctx.serviceName ?? "service"}</strong> has been suspended because invoice <strong>${ctx.reference}</strong> is unpaid.</p>
         <p><a href="${ctx.link ?? "#"}">Pay the outstanding amount</a> and your service reactivates automatically — no phone calls needed.</p>`
      ),
      whatsappParams: [ctx.serviceName ?? "service", ctx.link ?? ""],
      bellTitle: `Suspended: ${ctx.serviceName}`,
    }),
  },
  service_reactivated: {
    toCustomer: true,
    email: true,
    adminBell: true,
    salesBell: false,
    whatsappTemplate: "service_reactivated",
    render: (ctx) => ({
      subject: `Your ${ctx.serviceName ?? "service"} is back on`,
      text: `Payment received — your ${ctx.serviceName ?? "service"} has been reactivated. Thanks for sorting it out.`,
      html: wrapHtml(
        `<p>Payment received — your <strong>${ctx.serviceName ?? "service"}</strong> is back on. Thanks for sorting it out.</p>`
      ),
      whatsappParams: [ctx.serviceName ?? "service"],
      bellTitle: `Reactivated: ${ctx.serviceName}`,
    }),
  },
  cancellation_scheduled: {
    toCustomer: true,
    email: true,
    adminBell: true,
    salesBell: true,
    whatsappTemplate: "cancellation_scheduled",
    render: (ctx) => ({
      subject: `Cancellation confirmed for ${ctx.extra?.effectiveDate ?? "the end of your billing period"}`,
      text: `Your ${ctx.serviceName ?? "service"} will cancel on ${ctx.extra?.effectiveDate ?? "the end of your current billing period"}. It stays active until then. Changed your mind? Withdraw in your portal: ${ctx.link ?? ""}`,
      html: wrapHtml(
        `<p>Your <strong>${ctx.serviceName ?? "service"}</strong> is scheduled to cancel on <strong>${ctx.extra?.effectiveDate ?? "the end of your current billing period"}</strong> and stays active until then.</p>
         <p>Changed your mind? You can <a href="${ctx.link ?? "#"}">withdraw the cancellation</a> any time before that date.</p>`
      ),
      whatsappParams: [
        ctx.serviceName ?? "service",
        ctx.extra?.effectiveDate ?? "",
      ],
      bellTitle: `Cancellation scheduled: ${ctx.serviceName}`,
    }),
  },
  service_cancelled: {
    toCustomer: true,
    email: true,
    adminBell: true,
    salesBell: true,
    whatsappTemplate: "service_cancelled",
    render: (ctx) => ({
      subject: `Your ${ctx.serviceName ?? "service"} has been cancelled`,
      text: `Your ${ctx.serviceName ?? "service"} is now cancelled. Thanks for being with us — if you ever need connectivity again, you know where we are.`,
      html: wrapHtml(
        `<p>Your <strong>${ctx.serviceName ?? "service"}</strong> is now cancelled.</p>
         <p>Thanks for being with us. If you ever need connectivity again, you know where we are.</p>`
      ),
      whatsappParams: [ctx.serviceName ?? "service"],
      bellTitle: `Cancelled: ${ctx.serviceName}`,
    }),
  },
  quote_sent: {
    toCustomer: true,
    email: true,
    adminBell: false,
    salesBell: false,
    whatsappTemplate: "quote_sent",
    render: (ctx) => ({
      subject: `Your Needd Connect quote ${ctx.reference}`,
      text: `Your quote ${ctx.reference} is ready: ${ctx.link ?? ""}. It's valid for 14 days.`,
      html: wrapHtml(
        `<p>Your quote <strong>${ctx.reference}</strong> is ready.</p>
         <p><a href="${ctx.link ?? "#"}">View your quote</a> — valid for 14 days.</p>`
      ),
      whatsappParams: [ctx.reference ?? "", ctx.link ?? ""],
    }),
  },
  feasibility_result: {
    toCustomer: true,
    email: true,
    adminBell: false,
    salesBell: true,
    whatsappTemplate: "feasibility_result",
    render: (ctx) => ({
      subject: `Fibre at your address: ${ctx.extra?.outcome ?? "our findings"}`,
      text: ctx.extra?.message ?? "We've checked fibre availability at your address.",
      html: wrapHtml(`<p>${ctx.extra?.message ?? "We've checked fibre availability at your address."}</p>`),
      whatsappParams: [ctx.extra?.message ?? ""],
    }),
  },
};
