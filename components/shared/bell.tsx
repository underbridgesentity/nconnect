import Link from "next/link";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Bell } from "lucide-react";
import { db } from "@/lib/db/client";
import { notifications } from "@/lib/db/schema";
import { currentActor } from "@/lib/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MarkAllReadButton } from "./bell-client";

/** Bell notifications (spec §8): unread badge + recent list, per user. */
export async function NotificationBell({
  tone = "light",
}: {
  tone?: "light" | "dark";
}) {
  const actor = await currentActor();
  if (!actor) return null;

  const [unread] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(eq(notifications.userId, actor.userId), isNull(notifications.readAt))
    );
  const recent = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, actor.userId))
    .orderBy(desc(notifications.createdAt))
    .limit(12);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={`relative inline-flex size-8 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
          tone === "dark"
            ? "text-white/70 hover:bg-white/10 hover:text-white"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
        aria-label={`Notifications${unread.n ? ` (${unread.n} unread)` : ""}`}
      >
        <Bell className="size-4" />
        {unread.n > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-red-600 text-[9px] font-bold text-white">
            {unread.n > 9 ? "9+" : unread.n}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-sm font-semibold">Notifications</span>
          {unread.n > 0 ? <MarkAllReadButton /> : null}
        </div>
        {recent.length === 0 ? (
          <p className="px-2 py-4 text-center text-sm text-muted-foreground">
            Nothing yet.
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {recent.map((n) => (
              <Link
                key={n.id}
                href={n.link ?? "#"}
                className={`block border-t px-2 py-2 text-sm hover:bg-accent ${
                  n.readAt ? "opacity-60" : ""
                }`}
              >
                <span className="block font-medium">{n.title}</span>
                {n.body ? (
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {n.body}
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
