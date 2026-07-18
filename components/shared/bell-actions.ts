"use server";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { notifications } from "@/lib/db/schema";
import { requireActor } from "@/lib/auth";

export async function markAllNotificationsRead(): Promise<void> {
  const actor = await requireActor();
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(eq(notifications.userId, actor.userId), isNull(notifications.readAt))
    );
}
