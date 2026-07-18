import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import { authorize, type Actor } from "@/lib/auth/authorize";
import { writeAudit } from "./audit";

export async function getSetting<T>(key: string): Promise<T | null> {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  return (row?.value as T) ?? null;
}

export async function getSettingOr<T>(key: string, fallback: T): Promise<T> {
  return (await getSetting<T>(key)) ?? fallback;
}

export async function updateSetting(
  actor: Actor,
  key: string,
  value: unknown
): Promise<void> {
  authorize(actor, "settings.write");
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(settings)
      .where(eq(settings.key, key))
      .limit(1);
    await tx
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } });
    await writeAudit(tx, {
      actor,
      action: "settings.update",
      entity: "setting",
      entityId: key,
      before: before ? { value: before.value } : null,
      after: { value },
    });
  });
}
