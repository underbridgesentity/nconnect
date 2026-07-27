import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LifeBuoy, MessageCircle, Phone, Mail } from "lucide-react";
import { currentActor } from "@/lib/auth";
import { customerConversations } from "@/lib/domain/inbox";
import { getSetting } from "@/lib/domain/settings";
import { formatDateTime } from "@/lib/format";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusPill } from "@/components/shared/status-pill";
import { NewConversationForm } from "./client";

export const metadata: Metadata = { title: "Help" };

export default async function PortalHelpPage() {
  const actor = await currentActor();
  if (!actor?.customerId) redirect("/login");

  const [rows, company] = await Promise.all([
    customerConversations(actor.customerId),
    getSetting<{ phone?: string; email?: string }>("company"),
  ]);

  const phone = company?.phone ?? null;
  const email = company?.email ?? null;
  const whatsapp = phone
    ? `https://wa.me/27${phone.replace(/\D/g, "").replace(/^0/, "")}`
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Help</h1>
        <p className="text-sm text-muted-foreground">
          Real people answer, usually within business hours, often faster.
        </p>
      </div>

      <NewConversationForm />

      {rows.length === 0 ? (
        <EmptyState
          icon={LifeBuoy}
          sentence="No conversations yet. Start one above, it goes straight to the team that manages your services."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((conversation) => (
            <Link
              key={conversation.id}
              href={`/portal/help/${conversation.id}`}
              className="flex touch-target items-center justify-between rounded-2xl border bg-card p-4 hover:border-primary/40"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {conversation.subject ?? "Conversation"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {conversation.lastMessageAt
                    ? formatDateTime(conversation.lastMessageAt)
                    : "No messages yet"}
                </span>
              </span>
              <StatusPill status={conversation.status} />
            </Link>
          ))}
        </div>
      )}

      {/* Reachable without leaving the app, and both of these still work when
          the customer's own connection is the thing that is broken. */}
      {whatsapp || phone || email ? (
        <section className="rounded-2xl border bg-card p-4">
          <h2 className="text-sm font-semibold">Rather talk to someone?</h2>
          <div className="mt-2 space-y-1">
            {whatsapp ? (
              <a
                href={whatsapp}
                className="flex touch-target items-center gap-3 rounded-full px-2 text-sm hover:bg-muted"
              >
                <MessageCircle className="size-4 text-primary" aria-hidden />
                <span>
                  <span className="block font-medium">WhatsApp us</span>
                  <span className="block text-xs text-muted-foreground">
                    Quickest, and it works on a weak connection.
                  </span>
                </span>
              </a>
            ) : null}
            {phone ? (
              <a
                href={`tel:${phone.replace(/\s/g, "")}`}
                className="flex touch-target items-center gap-3 rounded-full px-2 text-sm hover:bg-muted"
              >
                <Phone className="size-4 text-primary" aria-hidden />
                <span>
                  <span className="block font-medium">{phone}</span>
                  <span className="block text-xs text-muted-foreground">
                    Office hours, Monday to Friday.
                  </span>
                </span>
              </a>
            ) : null}
            {email ? (
              <a
                href={`mailto:${email}`}
                className="flex touch-target items-center gap-3 rounded-full px-2 text-sm hover:bg-muted"
              >
                <Mail className="size-4 text-primary" aria-hidden />
                <span>
                  <span className="block font-medium">{email}</span>
                  <span className="block text-xs text-muted-foreground">
                    For anything formal or detailed.
                  </span>
                </span>
              </a>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
