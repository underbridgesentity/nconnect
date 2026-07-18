import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { conversations } from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import { threadMessages } from "@/lib/domain/inbox";
import { fileUrl } from "@/lib/storage";
import { StatusPill } from "@/components/shared/status-pill";
import { AutoRefresh } from "@/components/shared/auto-refresh";
import { cn } from "@/lib/utils";
import { PortalReplyBox } from "../client";

export const metadata: Metadata = { title: "Conversation" };

export default async function PortalThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await currentActor();
  if (!actor?.customerId) redirect("/login");

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);
  // Ownership scope: customers only ever see their own threads (§10.1).
  if (!conversation || conversation.customerId !== actor.customerId) {
    notFound();
  }

  const thread = (await threadMessages(id)).filter(
    (m) => m.direction !== "internal_note"
  );
  const attachmentUrls = new Map<string, string>();
  for (const message of thread) {
    for (const path of message.attachments) {
      attachmentUrls.set(path, await fileUrl("documents", path));
    }
  }

  return (
    <div className="flex h-[calc(100dvh-10rem)] flex-col">
      <AutoRefresh seconds={5} />
      <div className="flex items-center justify-between gap-2 pb-3">
        <div className="min-w-0">
          <Link
            href="/portal/help"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← All conversations
          </Link>
          <h1 className="truncate text-lg font-semibold">
            {conversation.subject ?? "Conversation"}
          </h1>
        </div>
        <StatusPill status={conversation.status} />
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto rounded-lg border bg-card p-4">
        {thread.map((message) => (
          <div
            key={message.id}
            className={cn(
              "max-w-[85%] rounded-lg p-3 text-sm",
              message.direction === "inbound"
                ? "ml-auto bg-primary text-primary-foreground"
                : "bg-muted"
            )}
          >
            <p className="whitespace-pre-wrap">{message.body}</p>
            {message.attachments.map((path) => (
              <a
                key={path}
                href={attachmentUrls.get(path)}
                target="_blank"
                rel="noreferrer"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URLs */}
                <img
                  src={attachmentUrls.get(path)}
                  alt="Attachment"
                  className="mt-2 max-h-48 rounded-md"
                />
              </a>
            ))}
            <p
              className={cn(
                "mt-1 text-[10px]",
                message.direction === "inbound"
                  ? "text-primary-foreground/70"
                  : "text-muted-foreground"
              )}
            >
              {message.direction === "inbound" ? "You · " : "Needd Connect · "}
              {message.createdAt.toISOString().replace("T", " ").slice(0, 16)}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-b-lg border-x border-b bg-card">
        <PortalReplyBox conversationId={id} />
      </div>
    </div>
  );
}
