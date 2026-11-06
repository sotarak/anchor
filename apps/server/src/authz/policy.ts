import type { Principal, ServiceTokenPrincipal, UserPrincipal } from "../env";
import { ApiError } from "../lib/errors";
import { getMembership, type MembershipRow } from "../members/repo";

export type Action =
  | "project:create"
  | "project:read"
  | "project:update"
  | "project:delete"
  | "environment:manage"
  | "secret:read"
  | "secret:write"
  | "member:manage"
  | "service_token:manage"
  | "audit:read"
  | "user:manage"
  | "invite:manage";

export type Resource = { projectId: string; environmentId?: string; path?: string };

/** Actions that only make sense for one project; calling them without projectId is a bug. */
const PROJECT_ACTIONS = new Set<Action>([
  "project:read",
  "project:update",
  "project:delete",
  "environment:manage",
  "secret:read",
  "secret:write",
  "member:manage",
  "service_token:manage",
]);

/** Project-level actions a member needs the project admin role for. */
const PROJECT_ADMIN_ACTIONS = new Set<Action>([
  "environment:manage",
  "project:update",
  "member:manage",
  "service_token:manage",
  "audit:read",
]);

/** Instance-wide actions reserved to instance owners and admins. */
const INSTANCE_ACTIONS = new Set<Action>([
  "project:create",
  "project:delete",
  "user:manage",
  "invite:manage",
]);

function forbidden(): ApiError {
  return new ApiError(403, "forbidden", "You do not have permission to perform this action");
}

/** Scope path p covers q when p is "/", q equals p, or q is inside p. Both are normalized. */
export function scopeMatches(scopePath: string, path: string): boolean {
  return scopePath === "/" || path === scopePath || path.startsWith(`${scopePath}/`);
}

function assertResource(action: Action, resource: Resource | undefined): void {
  const missing =
    (PROJECT_ACTIONS.has(action) && !resource?.projectId) ||
    (action.startsWith("secret:") &&
      (resource?.environmentId === undefined || resource.path === undefined));
  if (missing) throw new Error(`resource required for ${action}`);
}

function environmentAllowed(m: MembershipRow, environmentId: string | undefined): boolean {
  return (
    m.environment_ids === null || (!!environmentId && m.environment_ids.includes(environmentId))
  );
}

async function memberAllowed(
  db: D1Database,
  p: UserPrincipal,
  action: Action,
  resource: Resource | undefined,
): Promise<boolean> {
  if (INSTANCE_ACTIONS.has(action)) return false;
  if (!resource?.projectId) return false; // instance-wide audit
  const m = await getMembership(db, resource.projectId, p.userId);
  if (!m) return false;
  switch (action) {
    case "project:read":
      return true;
    case "secret:read":
      return environmentAllowed(m, resource.environmentId);
    case "secret:write":
      return m.role !== "viewer" && environmentAllowed(m, resource.environmentId);
    default:
      return PROJECT_ADMIN_ACTIONS.has(action) && m.role === "admin";
  }
}

function tokenAllowed(p: ServiceTokenPrincipal, action: Action, resource?: Resource): boolean {
  if (!resource || resource.projectId !== p.projectId) return false;
  if (action === "project:read") return true;
  if (action !== "secret:read" && action !== "secret:write") return false;
  if (action === "secret:write" && p.permission !== "read-write") return false;
  const { environmentId, path } = resource;
  return p.scopes.some(
    (s) => s.environmentId === environmentId && path !== undefined && scopeMatches(s.path, path),
  );
}

/**
 * Every route calls this before touching data. Reads memberships on every call (no cache), so
 * removing a member or revoking a token takes effect on the next request. Throws 403 when denied.
 */
export async function authorize(
  db: D1Database,
  principal: Principal,
  action: Action,
  resource?: Resource,
): Promise<void> {
  assertResource(action, resource);
  let allowed: boolean;
  if (principal.type === "service_token") {
    allowed = tokenAllowed(principal, action, resource);
  } else if (principal.role === "owner" || principal.role === "admin") {
    allowed = true;
  } else {
    allowed = await memberAllowed(db, principal, action, resource);
  }
  if (!allowed) throw forbidden();
}

/** Environments of a project the principal may see: "all", or an explicit (possibly empty) set. */
export async function visibleEnvironmentIds(
  db: D1Database,
  principal: Principal,
  projectId: string,
): Promise<Set<string> | "all"> {
  if (principal.type === "service_token") {
    if (principal.projectId !== projectId) return new Set();
    return new Set(principal.scopes.map((s) => s.environmentId));
  }
  if (principal.role === "owner" || principal.role === "admin") return "all";
  const m = await getMembership(db, projectId, principal.userId);
  if (!m) return new Set();
  return m.environment_ids === null ? "all" : new Set(m.environment_ids);
}
