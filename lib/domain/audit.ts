import "server-only";
import { type Tx } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";
import type { Actor } from "@/lib/auth/authorize";

/**
 * Audit writer (spec §2.7): financial and lifecycle mutations record who,
 * what, when, before, after — in the same transaction as the mutation.
 */

export const SYSTEM_ACTOR: Actor = {
  userId: "00000000-0000-0000-0000-000000000000",
  role: "admin",
};

export async function writeAudit(
  tx: Tx,
  params: {
    actor: Actor | null; // null for system/cron
    action: string; // dot notation, e.g. "service.suspend"
    entity: string;
    entityId: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    ip?: string | null;
  }
): Promise<void> {
  await tx.insert(auditLog).values({
    actorUserId: params.actor?.userId ?? null,
    actorRole: params.actor?.role ?? "system",
    action: params.action,
    entity: params.entity,
    entityId: params.entityId,
    before: params.before ?? null,
    after: params.after ?? null,
    ip: params.ip ?? null,
  });
}
