import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LifeBuoy } from "lucide-react";
import { currentActor } from "@/lib/auth";
import { customerConversations } from "@/lib/domain/inbox";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusPill } from "@/components/shared/status-pill";
import { NewConversationForm } from "./client";

export const metadata: Metadata = { title: "Help" };

export default async function PortalHelpPage() {
  const actor = await currentActor();
  if (!actor?.customerId) redirect("/login");

  const rows = await customerConversations(actor.customerId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Help</h1>
        <p className="text-sm text-muted-foreground">
          Real people answer — usually within business hours, often faster.
        </p>
      </div>

      <NewConversationForm />

      {rows.length === 0 ? (
        <EmptyState
          icon={LifeBuoy}
          sentence="No conversations yet. Start one above — it goes straight to the team that manages your services."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((conversation) => (
            <Link
              key={conversation.id}
              href={`/portal/help/${conversation.id}`}
              className="flex touch-target items-center justify-between rounded-lg border bg-card p-4 hover:border-primary/40"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {conversation.subject ?? "Conversation"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {conversation.lastMessageAt
                    ?.toISOString()
                    .replace("T", " ")
                    .slice(0, 16)}
                </span>
              </span>
              <StatusPill status={conversation.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
