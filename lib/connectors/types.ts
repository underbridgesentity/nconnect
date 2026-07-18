/**
 * Provider connector abstraction (spec §7). ManualConnector is the only
 * implementation at launch; future API connectors slot in with zero changes
 * to domain logic, UI, or customer experience.
 */

export type PlanCategory =
  | "lte_home"
  | "telkom_lte"
  | "fibre"
  | "voip"
  | "sim_data";

export interface AddressInput {
  line1: string;
  suburb?: string | null;
  city: string;
  postalCode?: string | null;
}

export type CoverageResult =
  | { mode: "available"; disclaimer: string }
  | { mode: "feasibility"; promise: string };

export interface ServiceContext {
  serviceId: string;
  customerId: string;
  planId: string;
  planName: string;
  category: PlanCategory;
  providerName: string;
}

export interface PlanRef {
  planId: string;
  planName: string;
}

/**
 * Outcome of a connector operation. ManualConnector returns mode "task":
 * the state machine advances only when staff complete the task. A future
 * API connector returns mode "done" and the state machine advances at once.
 */
export type ConnectorOutcome =
  | { mode: "task"; taskId: string }
  | { mode: "done"; externalRef?: string };

export interface UsageResult {
  usedBytes: number;
  periodStart: string;
  periodEnd: string;
}

export interface ProviderConnector {
  key: string; // 'manual', later 'telkom-api', etc.
  checkCoverage(input: {
    address: AddressInput;
    category: PlanCategory;
  }): Promise<CoverageResult>;
  activate(service: ServiceContext): Promise<ConnectorOutcome>;
  suspend(service: ServiceContext): Promise<ConnectorOutcome>;
  reactivate(service: ServiceContext): Promise<ConnectorOutcome>;
  cancel(service: ServiceContext): Promise<ConnectorOutcome>;
  changePlan(
    service: ServiceContext,
    newPlan: PlanRef
  ): Promise<ConnectorOutcome>;
  getUsage(service: ServiceContext): Promise<UsageResult | null>;
}
