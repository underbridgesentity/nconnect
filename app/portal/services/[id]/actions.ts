"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth";
import { changePlan } from "@/lib/domain/billing-engine";
import {
  requestCancellation,
  withdrawCancellation,
} from "@/lib/domain/services";

export async function changePlanAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  const serviceId = String(form.get("serviceId"));
  const newPlanId = String(form.get("newPlanId"));
  const result = await changePlan(actor, serviceId, newPlanId);
  revalidatePath(`/portal/services/${serviceId}`);
  if (result.kind === "upgrade") {
    redirect(
      `/portal/services/${serviceId}?changed=upgrade${result.charged ? "" : `&invoice=${result.invoiceId}`}`
    );
  }
  redirect(`/portal/services/${serviceId}?changed=downgrade&date=${result.effectiveDate}`);
}

export async function cancelServiceAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  const serviceId = String(form.get("serviceId"));
  const reason = String(form.get("reason") ?? "Customer requested");
  const { effectiveDate } = await requestCancellation(actor, serviceId, reason);
  revalidatePath(`/portal/services/${serviceId}`);
  redirect(`/portal/services/${serviceId}?cancelled=${effectiveDate}`);
}

export async function withdrawCancellationAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  const serviceId = String(form.get("serviceId"));
  await withdrawCancellation(actor, serviceId);
  revalidatePath(`/portal/services/${serviceId}`);
  redirect(`/portal/services/${serviceId}?withdrawn=1`);
}
