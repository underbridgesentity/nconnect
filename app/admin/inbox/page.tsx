import type { Metadata } from "next";
import Link from "next/link";
import { eq, or } from "drizzle-orm";
import { Inbox, MessageCircle, Globe } from "lucide-react";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import {
  listConversations,
  threadMessages,
} from "@/lib/domain/inbox";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusPill } from "@/components/shared/status-pill";
import { AutoRefresh } from "@/components/shared/auto-refresh";
import { cn } from "@/lib/utils";
import { ReplyBox, AssignSelect, StatusButtons } from "./client";

export const metadata: Metadata = { title: "Inbox" };

export default async function AdminInboxPage({
  searchParams,
}: {
  searchParams: Promise<{
    c?: string;
    status?: string;
    channel?: string;
    assignee?: string;
  }>;
}) {
  const { c, status, channel, assignee } = await searchParams;

  const [rows, staff] = await Promise.all([
    listConversations({
      status: status as "open" | undefined,
      channel: channel as "portal" | undefined,
      assignee: assignee as string | undefined,
    }),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(or(eq(users.role, "admin"), eq(users.role, "sales"))),
  ]);

  const selected = c ? rows.find((r) => r.conversation.id === c) : null;
  const thread = c ? await threadMessages(c) : [];

  const name = (customer: (typeof rows)[number]["customer"]) =>
    customer
      ? (customer.companyName ??
        [customer.firstName, customer.lastName].filter(Boolean).join(" "))
      : "Unidentified";

  const filters = (key: string, value: string | undefined, options: [string, string][]) => (
    <div className="flex gap-1">
      {options.map(([v, label]) => {
        const params = new URLSearchParams();
        if (status) params.set("status", status);
        if (channel) params.set("channel", channel);
        if (assignee) params.set("assignee", assignee);
        if (c) params.set("c", c);
        if (v) params.set(key, v);
        else params.delete(key);
        const active = (value ?? "") === v;
        return (
          <Link
            key={label}
            href={`/admin/inbox?${params.toString()}`}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs",
              active
                ? "bg-primary font-medium text-primary-foreground"
                : "border text-muted-foreground hover:bg-accent"
            )}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );

  return (
    <div className="mx-auto flex h-[calc(100dvh-6rem)] max-w-6xl flex-col gap-4 md:flex-row">
      <AutoRefresh seconds={5} />
      {/* Conversation list */}
      <div className={cn("flex w-full flex-col md:w-96", c && "hidden md:flex")}>
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <div className="mt-3 space-y-2">
          {filters("status", status, [
            ["", "All"],
            ["open", "Open"],
            ["pending", "Pending"],
            ["resolved", "Resolved"],
          ])}
          {filters("channel", channel, [
            ["", "All channels"],
            ["portal", "Portal"],
            ["whatsapp", "WhatsApp"],
          ])}
          {filters("assignee", assignee, [
            ["", "Anyone"],
            ["unassigned", "Unassigned"],
          ])}
        </div>
        <div className="mt-4 flex-1 space-y-1.5 overflow-y-auto pr-1">
          {rows.length === 0 ? (
            <EmptyState
              icon={Inbox}
              sentence="No conversations match. Portal messages and inbound WhatsApp land here the moment they arrive."
            />
          ) : (
            rows.map(({ conversation, customer }) => (
              <Link
                key={conversation.id}
                href={`/admin/inbox?c=${conversation.id}${status ? `&status=${status}` : ""}`}
                className={cn(
                  "block rounded-lg border p-3",
                  conversation.id === c
                    ? "border-primary bg-accent"
                    : "bg-card hover:border-primary/40"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {conversation.channel === "whatsapp" ? (
                      <MessageCircle className="size-3.5 text-emerald-600" aria-label="WhatsApp" />
                    ) : (
                      <Globe className="size-3.5 text-primary" aria-label="Portal" />
                    )}
                    {name(customer)}
                  </span>
                  <StatusPill status={conversation.status} />
                </div>
                {conversation.subject ? (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {conversation.subject}
                  </p>
                ) : null}
              </Link>
            ))
          )}
        </div>
      </div>

      {/* Thread */}
      <div className="flex min-w-0 flex-1 flex-col rounded-lg border bg-card">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <p className="text-sm text-muted-foreground">
              Pick a conversation to read and reply.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
              <div className="min-w-0">
                <Link
                  href="/admin/inbox"
                  className="text-xs text-muted-foreground hover:text-foreground md:hidden"
                >
                  ← All conversations
                </Link>
                <p className="truncate font-medium">
                  {name(selected.customer)}
                  {selected.customer ? (
                    <Link
                      href={`/admin/customers/${selected.customer.id}`}
                      className="ml-2 text-xs font-normal text-primary hover:underline"
                    >
                      View customer
                    </Link>
                  ) : null}
                </p>
                {selected.conversation.subject ? (
                  <p className="truncate text-xs text-muted-foreground">
                    {selected.conversation.subject}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <AssignSelect
                  conversationId={selected.conversation.id}
                  current={selected.conversation.assignedTo}
                  staff={staff}
                />
                <StatusButtons
                  conversationId={selected.conversation.id}
                  status={selected.conversation.status}
                />
              </div>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {thread.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "max-w-[85%] rounded-lg p-3 text-sm",
                    message.direction === "internal_note"
                      ? "mx-auto w-full max-w-full border border-dashed border-amber-300 bg-amber-50 text-amber-900"
                      : message.direction === "outbound"
                        ? "ml-auto bg-primary text-primary-foreground"
                        : "bg-muted"
                  )}
                >
                  {message.direction === "internal_note" ? (
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide">
                      Internal note, never sent
                    </p>
                  ) : null}
                  <p className="whitespace-pre-wrap">{message.body}</p>
                  <p
                    className={cn(
                      "mt-1 text-[10px]",
                      message.direction === "outbound"
                        ? "text-primary-foreground/70"
                        : "text-muted-foreground"
                    )}
                  >
                    {message.createdAt.toISOString().replace("T", " ").slice(0, 16)}
                  </p>
                </div>
              ))}
            </div>

            <ReplyBox conversationId={selected.conversation.id} />
          </>
        )}
      </div>
    </div>
  );
}
