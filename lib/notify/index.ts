import "server-only";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, customers, notifications } from "@/lib/db/schema";
import { sendEmail } from "./email";
import { sendWhatsAppTemplate, whatsappEnabled } from "./whatsapp";
import { TEMPLATES, type NotifyEvent } from "./templates";

/**
 * Single notification dispatcher (spec §8). Fans out per the matrix:
 * customer WhatsApp (template) with email as the formal record; if WhatsApp
 * is disabled the WhatsApp leg falls back to email so no event is silent.
 * Bell notifications are written for staff where the matrix says so.
 *
 * M2 ships the dispatcher + the events used so far; the full matrix and
 * template copy land with M5 and only extend `templates.ts`.
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

  // Customer legs
  if (customer && template.toCustomer) {
    let whatsappSent = false;
    if (whatsappEnabled() && customer.phone && template.whatsappTemplate) {
      const result = await sendWhatsAppTemplate({
        to: customer.phone,
        template: template.whatsappTemplate,
        bodyParams: rendered.whatsappParams,
      });
      whatsappSent = result.ok;
    }
    const shouldEmail =
      template.email || (!whatsappSent && template.whatsappTemplate != null);
    if (shouldEmail && customer.email) {
      await sendEmail({
        to: customer.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        attachments: ctx.attachments,
      });
    } else if (shouldEmail && !customer.email && !whatsappSent) {
      console.warn(
        `notify(${event}): customer ${customer.id} unreachable (no email, WhatsApp ${whatsappEnabled() ? "failed" : "disabled"})`
      );
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
