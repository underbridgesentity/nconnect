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
import { FilterPillLink } from "@/components/ui/filter-pill";
import { Input } from "@/components/ui/input";
import { currentActor } from "@/lib/auth";
import { formatAge, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BackLink } from "../back-link";
import { ReplyBox, AssignSelect, StatusButtons, ScrollToNewest } from "./client";

export const metadata: Metadata = { title: "Inbox" };

export default async function AdminInboxPage({
  searchParams,
}: {
  searchParams: Promise<{
    c?: string;
    status?: string;
    channel?: string;
    assignee?: string;
    q?: string;
  }>;
}) {
  const { c, status, channel, assignee, q } = await searchParams;
  const search = q?.trim();

  const [actor, rows, staff] = await Promise.all([
    currentActor(),
    listConversations({
      status: status as "open" | undefined,
      channel: channel as "portal" | undefined,
      assignee: assignee as string | undefined,
      search,
    }),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(or(eq(users.role, "admin"), eq(users.role, "sales"))),
  ]);

  const selected = c ? rows.find((r) => r.conversation.id === c) : null;
  const thread = c ? await threadMessages(c) : [];
  // Pinned once per render so the server HTML and the hydrated client agree.
  const now = new Date();

  const name = (customer: (typeof rows)[number]["customer"]) =>
    customer
      ? (customer.companyName ??
        [customer.firstName, customer.lastName].filter(Boolean).join(" "))
      : "Unidentified";

  /** Keep every active filter, plus the open thread, on every link. */
  const hrefWith = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const base: Record<string, string | undefined> = {
      status,
      channel,
      assignee,
      c,
      q: search,
      ...patch,
    };
    for (const [key, value] of Object.entries(base)) {
      if (value) params.set(key, value);
    }
    const query = params.toString();
    return query ? `/admin/inbox?${query}` : "/admin/inbox";
  };

  const filters = (
    key: string,
    value: string | undefined,
    options: [string, string][]
  ) => (
    <div className="flex flex-wrap gap-1">
      {options.map(([v, label]) => (
        <FilterPillLink
          key={label}
          href={hrefWith({ [key]: v || undefined })}
          active={(value ?? "") === v}
          size="sm"
        >
          {label}
        </FilterPillLink>
      ))}
    </div>
  );

  return (
    <div className="mx-auto flex h-[calc(100dvh-6rem)] max-w-6xl flex-col gap-4 md:flex-row">
      {/* Conversation list */}
      <div className={cn("flex w-full flex-col md:w-96", c && "hidden md:flex")}>
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
          {/* 15s, not 5s: two queries per tab every five seconds is a lot of
              load for a queue that also updates over realtime. The pause sits
              on the list because that is what moves under an operator who is
              part way through reading it. */}
          <AutoRefresh seconds={15} control className="-mr-2.5 shrink-0" />
        </div>
        <form method="get" action="/admin/inbox" className="mt-3">
          {status ? <input type="hidden" name="status" value={status} /> : null}
          {channel ? <input type="hidden" name="channel" value={channel} /> : null}
          {assignee ? (
            <input type="hidden" name="assignee" value={assignee} />
          ) : null}
          <Input
            name="q"
            defaultValue={search}
            placeholder="Search subject, customer or message…"
            aria-label="Search conversations"
          />
        </form>
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
            ...(actor ? ([[actor.userId, "Assigned to me"]] as [string, string][]) : []),
            ["unassigned", "Unassigned"],
          ])}
        </div>
        <div className="mt-4 flex-1 space-y-1.5 overflow-y-auto pr-1">
          {rows.length === 0 ? (
            <EmptyState
              icon={Inbox}
              sentence={
                search
                  ? `No conversations match "${search}".`
                  : "No conversations match. Portal messages and inbound WhatsApp land here the moment they arrive."
              }
            />
          ) : (
            rows.map(({ conversation, customer, lastBody, lastDirection }) => {
              // An inbound last message means the customer is waiting on us.
              const waitingOnUs =
                lastDirection === "inbound" && conversation.status !== "resolved";
              return (
                <Link
                  key={conversation.id}
                  href={hrefWith({ c: conversation.id })}
                  className={cn(
                    "block rounded-lg border p-3",
                    conversation.id === c
                      ? "border-primary bg-accent"
                      : "bg-card hover:border-primary/40"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                      {conversation.channel === "whatsapp" ? (
                        <MessageCircle
                          className="size-3.5 shrink-0 text-emerald-600"
                          aria-label="WhatsApp"
                        />
                      ) : (
                        <Globe
                          className="size-3.5 shrink-0 text-primary"
                          aria-label="Portal"
                        />
                      )}
                      <span className="truncate">{name(customer)}</span>
                      {waitingOnUs ? (
                        <span
                          className="size-2 shrink-0 rounded-full bg-amber-500"
                          title="Waiting on us"
                        />
                      ) : null}
                    </span>
                    <StatusPill status={conversation.status} />
                  </div>
                  {conversation.subject ? (
                    <p className="mt-0.5 truncate text-xs font-medium">
                      {conversation.subject}
                    </p>
                  ) : null}
                  <div className="mt-0.5 flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                    <span className="truncate">
                      {lastDirection === "outbound" ? "You: " : ""}
                      {lastBody ?? "No messages yet"}
                    </span>
                    {conversation.lastMessageAt ? (
                      <span
                        className={cn(
                          "tnum shrink-0",
                          waitingOnUs && "font-medium text-amber-700"
                        )}
                        title={formatDateTime(conversation.lastMessageAt)}
                      >
                        {formatAge(conversation.lastMessageAt, now)}
                      </span>
                    ) : null}
                  </div>
                </Link>
              );
            })
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
                {/*
                  The only way back to the list below md, where the rail is
                  hidden. It was a 12px glyph in a corner, which is the one
                  control on this screen an operator taps mid-conversation.
                */}
                <BackLink
                  href={hrefWith({ c: undefined })}
                  className="mb-1.5 md:hidden"
                >
                  All conversations
                </BackLink>
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
                    {formatDateTime(message.createdAt)}
                  </p>
                </div>
              ))}
              {/* Long threads used to open on the oldest message. */}
              <ScrollToNewest key={selected.conversation.id} />
            </div>

            <ReplyBox conversationId={selected.conversation.id} />
          </>
        )}
      </div>
    </div>
  );
}
