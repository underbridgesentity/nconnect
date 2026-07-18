import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ricaRecords } from "@/lib/db/schema";
import { authorize, type Actor } from "@/lib/auth/authorize";
import { writeAudit } from "./audit";
import { fileUrl } from "@/lib/storage";
import { decryptSensitive, maskIdNumber } from "@/lib/crypto";

/**
 * RICA verification (spec §13). Documents live in the private compliance
 * bucket; every signed-URL issuance and ID-number decryption is audited.
 * Records are retained 5 years after service termination — no deletes.
 */

export async function pendingRicaRecords() {
  return db
    .select()
    .from(ricaRecords)
    .where(eq(ricaRecords.status, "pending"));
}

/** Signed URLs for the verification view — issuance is audited (§13). */
export async function ricaDocUrls(
  actor: Actor,
  ricaId: string
): Promise<{ idDocUrl: string | null; poaDocUrl: string | null; idNumber: string }> {
  authorize(actor, "rica.verify");
  const [record] = await db
    .select()
    .from(ricaRecords)
    .where(eq(ricaRecords.id, ricaId))
    .limit(1);
  if (!record) throw new Error("RICA record not found");

  await db.transaction(async (tx) => {
    await writeAudit(tx, {
      actor,
      action: "rica.documents.read",
      entity: "rica_record",
      entityId: ricaId,
      after: { idDoc: Boolean(record.idDocPath), poaDoc: Boolean(record.poaDocPath) },
    });
  });

  return {
    idDocUrl: record.idDocPath
      ? await fileUrl("compliance", record.idDocPath, { expiresInSeconds: 600 })
      : null,
    poaDocUrl: record.poaDocPath
      ? await fileUrl("compliance", record.poaDocPath, { expiresInSeconds: 600 })
      : null,
    // Decrypted ONLY in the verification view (§13); masked elsewhere.
    idNumber: decryptSensitive(record.idNumberEncrypted),
  };
}

export function maskedIdNumber(encrypted: string): string {
  try {
    return maskIdNumber(decryptSensitive(encrypted));
  } catch {
    return "*** *** ????";
  }
}

export async function verifyRica(actor: Actor, ricaId: string): Promise<void> {
  authorize(actor, "rica.verify");
  await db.transaction(async (tx) => {
    const [record] = await tx
      .select()
      .from(ricaRecords)
      .where(eq(ricaRecords.id, ricaId))
      .limit(1);
    if (!record) throw new Error("RICA record not found");
    await tx
      .update(ricaRecords)
      .set({
        status: "verified",
        verifiedBy: actor.userId,
        verifiedAt: new Date(),
        rejectionReason: null,
      })
      .where(eq(ricaRecords.id, ricaId));
    await writeAudit(tx, {
      actor,
      action: "rica.verify",
      entity: "rica_record",
      entityId: ricaId,
      before: { status: record.status },
      after: { status: "verified" },
    });
  });
}

export async function rejectRica(
  actor: Actor,
  ricaId: string,
  reason: string
): Promise<void> {
  authorize(actor, "rica.verify");
  if (!reason.trim()) throw new Error("A rejection reason is required");
  await db.transaction(async (tx) => {
    const [record] = await tx
      .select()
      .from(ricaRecords)
      .where(eq(ricaRecords.id, ricaId))
      .limit(1);
    if (!record) throw new Error("RICA record not found");
    await tx
      .update(ricaRecords)
      .set({ status: "rejected", rejectionReason: reason })
      .where(eq(ricaRecords.id, ricaId));
    await writeAudit(tx, {
      actor,
      action: "rica.reject",
      entity: "rica_record",
      entityId: ricaId,
      before: { status: record.status },
      after: { status: "rejected", reason },
    });
  });
}
