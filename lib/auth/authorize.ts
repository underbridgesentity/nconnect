import {
  PERMISSION_MAP,
  type Capability,
  type Role,
  type Scope,
} from "./permissions";

export interface Actor {
  userId: string;
  role: Role;
  /** Present when role === "customer". */
  customerId?: string;
}

/**
 * A resource passes ownership data to the scope check. Callers provide the
 * fields relevant to the capability; missing fields fail closed.
 */
export interface ResourceScope {
  /** customers.id owning the resource (invoices, services, conversations…) */
  customerId?: string | null;
  /** users.id of the assigned sales rep (customers.assigned_sales_id) */
  assignedSalesId?: string | null;
  /** users.id owning the resource directly (leads.owner_sales_id, quotes.created_by) */
  ownerUserId?: string | null;
}

export class AuthorizationError extends Error {
  readonly capability: Capability;
  readonly role: Role;
  constructor(capability: Capability, role: Role) {
    super(`Not authorised: ${role} lacks ${capability}`);
    this.name = "AuthorizationError";
    this.capability = capability;
    this.role = role;
  }
}

function scopeAllows(
  scope: Scope,
  actor: Actor,
  resource?: ResourceScope
): boolean {
  switch (scope) {
    case "none":
      return false;
    case "all":
      return true;
    case "own": {
      // Sales: resource must be assigned to or owned by the actor.
      if (!resource) return false; // fail closed when no scoping data given
      if (resource.ownerUserId != null) return resource.ownerUserId === actor.userId;
      if (resource.assignedSalesId != null)
        return resource.assignedSalesId === actor.userId;
      return false;
    }
    case "self": {
      // Customer: resource must belong to the actor's customer record.
      if (!actor.customerId) return false;
      if (!resource) return false;
      return resource.customerId === actor.customerId;
    }
  }
}

/**
 * The single permission gate (spec §3.2). Domain functions call this before
 * executing. Throws AuthorizationError on denial.
 *
 * For capabilities where the actor's scope is "all" the resource argument is
 * optional; for "own"/"self" scopes it is required and fails closed if absent.
 * List queries should instead constrain by the actor (e.g. WHERE
 * assigned_sales_id = actor.userId) and may call `scopeFor()` to branch.
 */
export function authorize(
  actor: Actor,
  capability: Capability,
  resource?: ResourceScope
): void {
  const scope = PERMISSION_MAP[capability][actor.role];
  if (!scopeAllows(scope, actor, resource)) {
    throw new AuthorizationError(capability, actor.role);
  }
}

/** The actor's scope for a capability — for query-shaping in list endpoints. */
export function scopeFor(actor: Actor, capability: Capability): Scope {
  return PERMISSION_MAP[capability][actor.role];
}
