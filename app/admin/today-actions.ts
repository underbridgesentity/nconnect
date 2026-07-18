"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/auth";
import {
  completeProvisioningTask,
  toggleChecklistItem,
} from "@/lib/domain/services";
import { closeFeasibilityTask } from "@/lib/domain/leads";
import { verifyRica, rejectRica, ricaDocUrls } from "@/lib/domain/rica";

export type AdminActionResult = { ok: boolean; error?: string };

function fail(err: unknown): AdminActionResult {
  return { ok: false, error: err instanceof Error ? err.message : "Failed" };
}

export async function toggleChecklistAction(
  taskId: string,
  index: number,
  done: boolean
): Promise<AdminActionResult> {
  try {
    const actor = await requireActor();
    await toggleChecklistItem(actor, taskId, index, done);
    revalidatePath("/admin");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function completeTaskAction(
  form: FormData
): Promise<AdminActionResult> {
  try {
    const actor = await requireActor();
    await completeProvisioningTask(actor, {
      taskId: String(form.get("taskId")),
      resultNotes: String(form.get("resultNotes") ?? "") || undefined,
      externalRef: String(form.get("externalRef") ?? "") || undefined,
      msisdn: String(form.get("msisdn") ?? "") || undefined,
      circuitId: String(form.get("circuitId") ?? "") || undefined,
      simIccid: String(form.get("simIccid") ?? "") || undefined,
    });
    revalidatePath("/admin");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function closeFeasibilityAction(
  form: FormData
): Promise<AdminActionResult> {
  try {
    const actor = await requireActor();
    await closeFeasibilityTask(
      String(form.get("taskId")),
      actor.userId,
      String(form.get("resultNotes") ?? "")
    );
    revalidatePath("/admin");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function verifyRicaAction(
  ricaId: string
): Promise<AdminActionResult> {
  try {
    const actor = await requireActor();
    await verifyRica(actor, ricaId);
    revalidatePath("/admin");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function rejectRicaAction(
  form: FormData
): Promise<AdminActionResult> {
  try {
    const actor = await requireActor();
    await rejectRica(
      actor,
      String(form.get("ricaId")),
      String(form.get("reason") ?? "")
    );
    revalidatePath("/admin");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function ricaDocUrlsAction(ricaId: string): Promise<
  | { ok: true; idDocUrl: string | null; poaDocUrl: string | null; idNumber: string }
  | { ok: false; error: string }
> {
  try {
    const actor = await requireActor();
    const result = await ricaDocUrls(actor, ricaId);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
}
