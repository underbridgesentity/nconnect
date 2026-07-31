import "server-only";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, customers, notifications } from "@/lib/db/schema";
import { sendEmail } from "./email";
import { sendWhatsAppTemplate, whatsappRecipient } from "./whatsapp";
import { TEMPLATES, type NotifyEvent } from "./templates";

/**
 * Single notification dispatcher (spec §8).
 *
 * Email is the channel. Every customer notification goes out by email, which
 * is both the delivery and the formal record, so a customer with an account
 * is never dependent on a messaging platform to hear from us.
 *
 * WhatsApp is an optional extra copy of the same message, sent only to
 * customers who opted in while WHATSAPP_ENABLED is on (see `whatsappRecipient`).
 * It is sent after the email and its failure is logged rather than escalated:
 * the customer has already been told, so a Meta outage is not a lost event.
 *
 * Bell notifications are written for staff where the matrix says so.
 */

export interface NotifyContext {
  customerId?: string;
  amountCents?: number;
  reference?: string;
  link?: string;
  serviceName?: string;
  attachments?: { filename: string; content: Buffer }[];
  extra?: Record<string, string>;
}

export async function notify(
  event: NotifyEvent,
  ctx: NotifyContext
): Promise<void> {
  const template = TEMPLATES[event];
  if (!template) {
    console.error(`notify: unknown event ${event}`);
    return;
  }

  const customer = ctx.customerId
    ? (
        await db
          .select()
          .from(customers)
          .where(eq(customers.id, ctx.customerId))
          .limit(1)
      )[0]
    : null;

  const rendered = template.render(ctx);

  // Customer legs. Email first and always, WhatsApp only as an opt-in echo.
  if (customer && template.toCustomer) {
    if (customer.email) {
      const result = await sendEmail({
        to: customer.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        attachments: ctx.attachments,
      });
      if (!result.ok) {
        console.error(
          `notify(${event}): email to customer ${customer.id} failed: ${result.detail}`
        );
      }
    } else {
      // Customers sign in with an email address, so this means an older or
      // staff-created record. Surface it instead of quietly going silent.
      console.warn(
        `notify(${event}): customer ${customer.id} has no email address on file, notification not delivered`
      );
    }

    const whatsappTo = template.whatsappTemplate
      ? whatsappRecipient(customer)
      : null;
    if (whatsappTo && template.whatsappTemplate) {
      const result = await sendWhatsAppTemplate({
        to: whatsappTo,
        template: template.whatsappTemplate,
        bodyParams: rendered.whatsappParams,
      });
      if (!result.ok) {
        console.warn(
          `notify(${event}): WhatsApp copy to customer ${customer.id} failed: ${result.detail}`
        );
      }
    }
  }

  // Admin bell
  if (template.adminBell) {
    const admins = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.status, "active")));
    if (admins.length) {
      await db.insert(notifications).values(
        admins.map((a) => ({
          userId: a.id,
          type: event,
          title: rendered.bellTitle ?? rendered.subject,
          body: rendered.text.slice(0, 300),
          link: ctx.link ?? null,
        }))
      );
    }
  }

  // Sales bell (own customer)
  if (template.salesBell && customer?.assignedSalesId) {
    await db.insert(notifications).values({
      userId: customer.assignedSalesId,
      type: event,
      title: rendered.bellTitle ?? rendered.subject,
      body: rendered.text.slice(0, 300),
      link: ctx.link ?? null,
    });
  }
}
