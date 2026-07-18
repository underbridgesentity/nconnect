"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/auth";
import {
  postMessage,
  assignConversation,
  setConversationStatus,
  startConversation,
} from "@/lib/domain/inbox";

export type Result = { ok: boolean; error?: string };
const fail = (err: unknown): Result => ({
  ok: false,
  error: err instanceof Error ? err.message : "Failed",
});

export async function replyAction(form: FormData): Promise<Result> {
  try {
    const actor = await requireActor();
    await postMessage(actor, {
      conversationId: String(form.get("conversationId")),
      body: String(form.get("body") ?? "").trim(),
      internal: form.get("internal") === "on",
    });
    revalidatePath("/admin/inbox");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function assignAction(
  conversationId: string,
  userId: string | null
): Promise<Result> {
  try {
    const actor = await requireActor();
    await assignConversation(actor, conversationId, userId);
    revalidatePath("/admin/inbox");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function statusAction(
  conversationId: string,
  status: "open" | "pending" | "resolved"
): Promise<Result> {
  try {
    const actor = await requireActor();
    await setConversationStatus(actor, conversationId, status);
    revalidatePath("/admin/inbox");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function startConversationAction(form: FormData): Promise<Result> {
  try {
    const actor = await requireActor();
    await startConversation(actor, {
      customerId: String(form.get("customerId")),
      channel: (String(form.get("channel")) as "portal" | "whatsapp") ?? "portal",
      subject: String(form.get("subject") ?? "") || null,
      body: String(form.get("body") ?? "").trim(),
    });
    revalidatePath("/admin/inbox");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
