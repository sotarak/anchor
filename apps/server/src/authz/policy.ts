import type { Principal } from "../env";
import { ApiError } from "../lib/errors";

export type Action =
  | "project:create"
  | "project:read"
  | "project:update"
  | "project:delete"
  | "environment:manage"
  | "secret:read"
  | "secret:write";

/** Every route calls this before touching data. Throws 403 when the action is not allowed. */
export function authorize(
  principal: Principal,
  _action: Action,
  _resource?: { projectId: string },
): void {
  // M2: memberships, env restrictions, service-token scopes
  if (principal.role === "owner" || principal.role === "admin") return;
  throw new ApiError(403, "forbidden", "You do not have permission to perform this action");
}
