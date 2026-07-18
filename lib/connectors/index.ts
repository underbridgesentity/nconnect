import "server-only";
import type { ProviderConnector } from "./types";
import { manualConnector } from "./manual";

/**
 * Connector registry (spec §7): ManualConnector for all providers now.
 * Future API connectors are keyed by provider and slot in here with zero
 * changes elsewhere.
 */
export function getConnector(_providerName?: string): ProviderConnector {
  return manualConnector;
}

export * from "./types";
