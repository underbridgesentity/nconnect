"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/auth";
import { startConversation, postMessage } from "@/lib/domain/inbox";
import { uploadFile, randomFileName } from "@/lib/storage";
import { customerFacingError } from "@/app/portal/_lib/errors";

export type Result = { ok: boolean; error?: string; conversationId?: string };
/**
 * Never hand a customer a raw domain or driver message: map the ones they can
 * trigger to plain language and collapse the rest to a single honest line
 * (the original is logged server-side).
 */
const fail = (err: unknown): Result => ({
  ok: false,
  error: customerFacingError(err),
});

/*
 * sharp is loaded where it is used, not at module scope.
 *
 * This module is imported by the page that renders the form, so a top-level
 * import pulled sharp's native binding into every render of that page. On
 * Vercel's linux-x64 runtime the binding failed to load and took the whole page
 * down with a 500, even though nothing on it was processing an image. Loading
 * it inside the handler keeps the failure where it belongs: an upload that
 * cannot be processed, not a page that cannot be viewed.
 */
async function processAttachment(
  file: File,
  customerId: string
): Promise<string> {
  const sharp = (await import("sharp")).default;
  if (file.size > 10 * 1024 * 1024) throw new Error("Photo too large (max 10MB)");
  const input = Buffer.from(await file.arrayBuffer());
  const webp = await sharp(input)
    .rotate()
    .resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  const path = `conversations/${customerId}/${randomFileName(".webp")}`;
  await uploadFile("documents", path, webp, "image/webp");
  return path;
}

export async function startPortalConversationAction(
  form: FormData
): Promise<Result> {
  try {
    const actor = await requireActor();
    if (!actor.customerId) throw new Error("No customer account");
    const attachments: string[] = [];
    const photo = form.get("photo") as File | null;
    if (photo && photo.size > 0) {
      attachments.push(await processAttachment(photo, actor.customerId));
    }
    const { conversationId } = await startConversation(actor, {
      customerId: actor.customerId,
      channel: "portal",
      subject: String(form.get("subject") ?? "") || null,
      body: String(form.get("body") ?? "").trim(),
      attachments,
    });
    revalidatePath("/portal/help");
    return { ok: true, conversationId };
  } catch (err) {
    return fail(err);
  }
}

export async function portalReplyAction(form: FormData): Promise<Result> {
  try {
    const actor = await requireActor();
    if (!actor.customerId) throw new Error("No customer account");
    const conversationId = String(form.get("conversationId"));
    const attachments: string[] = [];
    const photo = form.get("photo") as File | null;
    if (photo && photo.size > 0) {
      attachments.push(await processAttachment(photo, actor.customerId));
    }
    await postMessage(actor, {
      conversationId,
      body: String(form.get("body") ?? "").trim(),
      attachments,
    });
    revalidatePath(`/portal/help/${conversationId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
