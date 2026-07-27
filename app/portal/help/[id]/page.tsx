import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { conversations } from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import { threadMessages } from "@/lib/domain/inbox";
import { fileUrl } from "@/lib/storage";
import { formatDateTime } from "@/lib/format";
import { StatusPill } from "@/components/shared/status-pill";
import { cn } from "@/lib/utils";
import { isUuid } from "@/app/portal/_lib/uuid";
import { PortalReplyBox } from "../client";
import { LiveUpdates } from "./live-updates";

export const metadata: Metadata = { title: "Conversation" };

export default async function PortalThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
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
  // One signing round trip per attachment, run concurrently: this page is
  // re-rendered by the live updates poll, so serial awaits are paid over and
  // over on a mobile connection.
  const paths = [...new Set(thread.flatMap((message) => message.attachments))];
  const signed = await Promise.all(
    paths.map(async (path) => [path, await fileUrl("documents", path)] as const)
  );
  const attachmentUrls = new Map(signed);

  return (
    <div className="flex h-[calc(100dvh-10rem)] flex-col">
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

      <div
        className="flex-1 space-y-3 overflow-y-auto rounded-t-2xl border bg-card p-4"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Conversation messages"
      >
        {thread.map((message) => (
          <div
            key={message.id}
            className={cn(
              "max-w-[85%] rounded-2xl p-3 text-sm",
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
              {formatDateTime(message.createdAt)}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-b-2xl border-x border-b bg-card">
        <PortalReplyBox conversationId={id} />
        <div className="flex justify-end px-3 pb-2">
          <LiveUpdates seconds={15} />
        </div>
      </div>
    </div>
  );
}
