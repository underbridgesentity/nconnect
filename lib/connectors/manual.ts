import "server-only";
import { db } from "@/lib/db/client";
import { provisioningTasks, type ChecklistItem } from "@/lib/db/schema";
import type {
  ProviderConnector,
  ServiceContext,
  ConnectorOutcome,
  PlanRef,
  PlanCategory,
} from "./types";

/**
 * ManualConnector (spec §7): every lifecycle method creates a provisioning
 * task with a type-specific checklist; staff perform the work in provider
 * portals and complete the task, which advances the state machine.
 */

const SIM_CATEGORIES: PlanCategory[] = ["lte_home", "telkom_lte", "sim_data"];

function checklist(items: string[]): ChecklistItem[] {
  return items.map((label) => ({ label, done: false }));
}

function activationChecklist(ctx: ServiceContext): ChecklistItem[] {
  if (SIM_CATEGORIES.includes(ctx.category)) {
    return checklist([
      "Confirm RICA verified",
      "Allocate SIM from stock",
      `Activate on ${ctx.providerName} portal`,
      "Record MSISDN and external ref",
      "Confirm data allocation live",
      ...(ctx.category === "lte_home"
        ? ["Confirm router dispatched / delivered"]
        : []),
    ]);
  }
  if (ctx.category === "fibre") {
    return checklist([
      "Confirm feasibility / installation complete",
      `Order line on ${ctx.providerName} portal`,
      "Record circuit ID and external ref",
      "Confirm line active and speeds correct",
      "Confirm router configured / delivered",
    ]);
  }
  // voip
  return checklist([
    "Provision extensions on the VoIP platform",
    "Record account external ref",
    "Port or assign the geographic number",
    "Test inbound and outbound calls",
  ]);
}

const TASK_CHECKLISTS: Record<
  "suspend" | "reactivate" | "cancel" | "change_plan",
  (ctx: ServiceContext) => ChecklistItem[]
> = {
  suspend: (ctx) =>
    checklist([
      `Suspend service on ${ctx.providerName} portal`,
      "Confirm service is offline",
    ]),
  reactivate: (ctx) =>
    checklist([
      `Reactivate service on ${ctx.providerName} portal`,
      "Confirm service is back online",
    ]),
  cancel: (ctx) =>
    checklist([
      `Cancel service on ${ctx.providerName} portal`,
      "Confirm final billing with provider",
      ...(SIM_CATEGORIES.includes(ctx.category)
        ? ["Deactivate SIM"]
        : []),
    ]),
  change_plan: (ctx) =>
    checklist([
      `Change package on ${ctx.providerName} portal`,
      "Confirm new allocation/speed is live",
    ]),
};

async function createTask(
  ctx: ServiceContext,
  type: "activate" | "suspend" | "reactivate" | "cancel" | "change_plan",
  items: ChecklistItem[],
  dueHours: number
): Promise<ConnectorOutcome> {
  const [task] = await db
    .insert(provisioningTasks)
    .values({
      serviceId: ctx.serviceId,
      type,
      status: "open",
      dueAt: new Date(Date.now() + dueHours * 60 * 60 * 1000),
      checklist: items,
    })
    .returning({ id: provisioningTasks.id });
  return { mode: "task", taskId: task.id };
}

export const manualConnector: ProviderConnector = {
  key: "manual",

  async checkCoverage({ category }) {
    if (category === "fibre") {
      return {
        mode: "feasibility",
        promise:
          "We confirm fibre availability at your address within one business day, on WhatsApp.",
      };
    }
    return {
      mode: "available",
      disclaimer:
        "LTE and 5G cover most of South Africa; exact speeds depend on signal strength at your address and network load. 5G needs 5G coverage in your suburb and falls back to 4G where limited.",
    };
  },

  async activate(ctx) {
    return createTask(ctx, "activate", activationChecklist(ctx), 24);
  },
  async suspend(ctx) {
    return createTask(ctx, "suspend", TASK_CHECKLISTS.suspend(ctx), 12);
  },
  async reactivate(ctx) {
    return createTask(ctx, "reactivate", TASK_CHECKLISTS.reactivate(ctx), 12);
  },
  async cancel(ctx) {
    return createTask(ctx, "cancel", TASK_CHECKLISTS.cancel(ctx), 48);
  },
  async changePlan(ctx, _newPlan: PlanRef) {
    return createTask(ctx, "change_plan", TASK_CHECKLISTS.change_plan(ctx), 24);
  },
  async getUsage() {
    // No usage data at launch, the portal renders no usage module (§7).
    return null;
  },
};
