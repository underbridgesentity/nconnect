import "server-only";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  conversations,
  messages,
  customers,
  users,
  notifications,
} from "@/lib/db/schema";
import { authorize, type Actor } from "@/lib/auth/authorize";
import { writeAudit } from "./audit";
import { emitDomainEvent } from "./events";
import { broadcast } from "@/lib/realtime";
import { sendWhatsAppText, whatsappEnabled } from "@/lib/notify/whatsapp";
import { sendEmail } from "@/lib/notify/email";

/**
 * Unified inbox (spec §4.5, §9.4.5): portal and WhatsApp conversations in
 * one queue. This replaces v1's split Tickets + Communications entirely.
 */

async function conversationScope(conversationId: string) {
  const [conv] = await db
    .select({
      customerId: conversations.customerId,
      assignedSalesId: customers.assignedSalesId,
    })
    .from(conversations)
    .leftJoin(customers, eq(conversations.customerId, customers.id))
    .where(eq(conversations.id, conversationId))
    .limit(1);
  return conv;
}

export async function startConversation(
  actor: Actor,
  input: {
    customerId: string;
    channel: "portal" | "whatsapp";
    subject?: string | null;
    body: string;
    attachments?: string[];
  }
): Promise<{ conversationId: string }> {
  authorize(actor, "inbox.reply", {
    customerId: input.customerId,
  });

  const conversationId = await db.transaction(async (tx) => {
    const [conv] = await tx
      .insert(conversations)
      .values({
        customerId: input.customerId,
        channel: input.channel,
        subject: input.subject ?? null,
        status: "open",
        lastMessageAt: new Date(),
      })
      .returning({ id: conversations.id });
    await tx.insert(messages).values({
      conversationId: conv.id,
      direction: actor.role === "customer" ? "inbound" : "outbound",
      authorUserId: actor.userId,
      body: input.body,
      attachments: input.attachments ?? [],
    });
    await writeAudit(tx, {
      actor,
      action: "conversation.start",
      entity: "conversation",
      entityId: conv.id,
      after: { channel: input.channel, subject: input.subject },
    });
    await emitDomainEvent(tx, "conversation.message", {
      conversationId: conv.id,
      direction: actor.role === "customer" ? "inbound" : "outbound",
    });
    return conv.id;
  });

  await broadcast("admin:inbox", "conversation", { conversationId });
  if (actor.role === "customer") {
    await notifyStaffOfInbound(conversationId);
  }
  return { conversationId };
}

/**
 * Post a message into a conversation. Staff replies go out on the
 * conversation's channel (§8 conversation_reply: WhatsApp if channel is
 * whatsapp; bell + email if portal). Internal notes are never sent.
 */
export async function postMessage(
  actor: Actor,
  input: {
    conversationId: string;
    body: string;
    internal?: boolean;
    attachments?: string[];
  }
): Promise<void> {
  const scope = await conversationScope(input.conversationId);
  if (!scope) throw new Error("Conversation not found");
  authorize(actor, "inbox.reply", {
    customerId: scope.customerId,
    assignedSalesId: scope.assignedSalesId,
  });

  const isStaff = actor.role !== "customer";
  const direction = input.internal
    ? ("internal_note" as const)
    : isStaff
      ? ("outbound" as const)
      : ("inbound" as const);
  if (input.internal && !isStaff) {
    throw new Error("Internal notes are staff-only");
  }

  await db.transaction(async (tx) => {
    await tx.insert(messages).values({
      conversationId: input.conversationId,
      direction,
      authorUserId: actor.userId,
      body: input.body,
      attachments: input.attachments ?? [],
    });
    await tx
      .update(conversations)
      .set({
        lastMessageAt: new Date(),
        // A customer message reopens a resolved thread.
        ...(direction === "inbound" ? { status: "open" as const } : {}),
      })
      .where(eq(conversations.id, input.conversationId));
    await emitDomainEvent(tx, "conversation.message", {
      conversationId: input.conversationId,
      direction,
    });
  });

  await broadcast(`conversation:${input.conversationId}`, "message", {});
  await broadcast("admin:inbox", "message", {
    conversationId: input.conversationId,
  });

  if (direction === "inbound") {
    await notifyStaffOfInbound(input.conversationId);
  }
  if (direction === "outbound" && scope.customerId) {
    await deliverStaffReply(input.conversationId, scope.customerId, input.body);
  }
}

/** §8 conversation_reply delivery per channel. */
async function deliverStaffReply(
  conversationId: string,
  customerId: string,
  body: string
): Promise<void> {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  if (!conv || !customer) return;

  if (conv.channel === "whatsapp" && whatsappEnabled() && customer.phone) {
    const result = await sendWhatsAppText(customer.phone, body);
    if (result.ok) return;
  }
  // Portal channel (or WhatsApp fallback): bell + email.
  if (customer.userId) {
    await db.insert(notifications).values({
      userId: customer.userId,
      type: "conversation_reply",
      title: conv.subject ? `Reply: ${conv.subject}` : "New reply from Needd Connect",
      body: body.slice(0, 300),
      link: `/portal/help/${conversationId}`,
    });
    await broadcast(`user:${customer.userId}`, "bell", {});
  }
  if (customer.email) {
    await sendEmail({
      to: customer.email,
      subject: conv.subject
        ? `Re: ${conv.subject}, Needd Connect`
        : "New reply from Needd Connect support",
      html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px"><p>${body.replace(/\n/g, "<br/>")}</p><p style="margin-top:24px;font-size:13px"><a href="${process.env.APP_URL}/portal/help/${conversationId}">Reply in your portal</a></p></div>`,
      text: `${body}\n\nReply in your portal: ${process.env.APP_URL}/portal/help/${conversationId}`,
    });
  }
}

/** Admin bell + realtime for new inbound messages (§8). */
async function notifyStaffOfInbound(conversationId: string): Promise<void> {
  const scope = await conversationScope(conversationId);
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  const customerName = scope?.customerId
    ? await (async () => {
        const [c] = await db
          .select()
          .from(customers)
          .where(eq(customers.id, scope.customerId!))
          .limit(1);
        return c
          ? (c.companyName ?? [c.firstName, c.lastName].filter(Boolean).join(" "))
          : "Unknown";
      })()
    : "Unidentified";

  const admins = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.status, "active")));
  const targets = [...admins.map((a) => a.id)];
  if (scope?.assignedSalesId) targets.push(scope.assignedSalesId);
  if (targets.length) {
    await db.insert(notifications).values(
      targets.map((userId) => ({
        userId,
        type: "new_inbound_message",
        title: `New message from ${customerName}`,
        body: conv?.subject ?? conv?.channel ?? "",
        link: `/admin/inbox?c=${conversationId}`,
      }))
    );
  }
  await broadcast("admin:inbox", "inbound", { conversationId });
}

export async function assignConversation(
  actor: Actor,
  conversationId: string,
  userId: string | null
): Promise<void> {
  authorize(actor, "inbox.reply", await conversationScope(conversationId));
  if (actor.role !== "admin") throw new Error("Only admins assign threads");
  await db.transaction(async (tx) => {
    await tx
      .update(conversations)
      .set({ assignedTo: userId })
      .where(eq(conversations.id, conversationId));
    await writeAudit(tx, {
      actor,
      action: "conversation.assign",
      entity: "conversation",
      entityId: conversationId,
      after: { assignedTo: userId },
    });
  });
  await broadcast("admin:inbox", "conversation", { conversationId });
}

export async function setConversationStatus(
  actor: Actor,
  conversationId: string,
  status: "open" | "pending" | "resolved"
): Promise<void> {
  const scope = await conversationScope(conversationId);
  authorize(actor, "inbox.reply", scope);
  await db.transaction(async (tx) => {
    await tx
      .update(conversations)
      .set({ status })
      .where(eq(conversations.id, conversationId));
    await writeAudit(tx, {
      actor,
      action: `conversation.${status}`,
      entity: "conversation",
      entityId: conversationId,
      after: { status },
    });
  });
  await broadcast("admin:inbox", "conversation", { conversationId });
}

// ------------------------------------------------------- WhatsApp inbound

/**
 * Inbound WhatsApp (§3, §8): find-or-create the conversation for the phone
 * number, insert idempotently by WhatsApp message id, reopen if resolved.
 */
export async function ingestWhatsAppMessage(input: {
  fromPhone: string; // E.164 without +
  externalId: string;
  body: string;
  timestamp?: number;
}): Promise<void> {
  const phone = `+${input.fromPhone.replace(/^\+/, "")}`;

  // Idempotency on the WhatsApp message id.
  const [existing] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.externalId, input.externalId))
    .limit(1);
  if (existing) return;

  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.phone, phone))
    .limit(1);

  // Latest whatsapp conversation for this customer/phone, else create.
  const [conv] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.channel, "whatsapp"),
        customer
          ? eq(conversations.customerId, customer.id)
          : isNull(conversations.customerId)
      )
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(1);

  const conversationId = await db.transaction(async (tx) => {
    let id = conv?.id;
    if (!id) {
      const [created] = await tx
        .insert(conversations)
        .values({
          customerId: customer?.id ?? null,
          channel: "whatsapp",
          subject: customer ? null : `WhatsApp ${phone}`,
          status: "open",
          lastMessageAt: new Date(),
        })
        .returning({ id: conversations.id });
      id = created.id;
    }
    await tx.insert(messages).values({
      conversationId: id,
      direction: "inbound",
      body: input.body,
      externalId: input.externalId,
      deliveredAt: input.timestamp ? new Date(input.timestamp * 1000) : new Date(),
    });
    await tx
      .update(conversations)
      .set({ lastMessageAt: new Date(), status: "open" })
      .where(eq(conversations.id, id));
    await emitDomainEvent(tx, "conversation.message", {
      conversationId: id,
      direction: "inbound",
      channel: "whatsapp",
    });
    return id;
  });

  await broadcast(`conversation:${conversationId}`, "message", {});
  await notifyStaffOfInbound(conversationId);
}

// ----------------------------------------------------------------- queries

export async function listConversations(filter: {
  status?: "open" | "pending" | "resolved";
  channel?: "portal" | "whatsapp";
  assignee?: string | "unassigned";
}) {
  return db
    .select({ conversation: conversations, customer: customers })
    .from(conversations)
    .leftJoin(customers, eq(conversations.customerId, customers.id))
    .where(
      and(
        filter.status ? eq(conversations.status, filter.status) : undefined,
        filter.channel ? eq(conversations.channel, filter.channel) : undefined,
        filter.assignee === "unassigned"
          ? isNull(conversations.assignedTo)
          : filter.assignee
            ? eq(conversations.assignedTo, filter.assignee)
            : undefined
      )
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(100);
}

export async function threadMessages(conversationId: string) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt);
}

export async function unreadBellCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(eq(notifications.userId, userId), isNull(notifications.readAt))
    );
  return row.n;
}

export async function customerConversations(customerId: string) {
  return db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.customerId, customerId),
        or(
          eq(conversations.channel, "portal"),
          eq(conversations.channel, "whatsapp")
        )
      )
    )
    .orderBy(desc(conversations.lastMessageAt));
}
