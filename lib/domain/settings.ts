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

/**
 * Read a setting for presentational chrome, treating an unreadable database as
 * "not configured" rather than an exception.
 *
 * Page furniture must never be able to take a page down. The site footer reads
 * the company details, so when the database was briefly unreachable every
 * otherwise-static marketing page answered 500, because the caller's `company
 * ? ... : null` guard never got the chance to run.
 *
 * Only for decoration. Anything where being wrong costs money or misleads a
 * customer (banking details on an invoice, dunning configuration, pricing)
 * must keep using getSetting and be allowed to fail loudly.
 */
export async function getSettingForDisplay<T>(key: string): Promise<T | null> {
  try {
    return await getSetting<T>(key);
  } catch (err) {
    console.error(`settings: could not read "${key}" for display:`, err);
    return null;
  }
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
