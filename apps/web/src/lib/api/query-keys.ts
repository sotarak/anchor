import type { AuditFilters } from "./endpoints";

/** Query keys. No key and no cached query ever holds a secret value. */
export const qk = {
  me: ["me"] as const,
  setupStatus: ["setup-status"] as const,
  projects: ["projects"] as const,
  project: (p: string) => ["projects", p] as const,
  overview: (p: string, path: string) => ["projects", p, "overview", path] as const,
  overviewAll: (p: string) => ["projects", p, "overview"] as const,
  environments: (p: string) => ["projects", p, "environments"] as const,
  secrets: (p: string, env: string, path: string) =>
    ["projects", p, "environments", env, "secrets", path] as const,
  /** Under `secrets(p, env, path)`, so invalidating that list refreshes the history too. */
  secretVersions: (p: string, env: string, path: string, key: string) =>
    ["projects", p, "environments", env, "secrets", path, "versions", key] as const,
  secretsAll: (p: string, env: string) => ["projects", p, "environments", env, "secrets"] as const,
  folders: (p: string, env: string, path: string) =>
    ["projects", p, "environments", env, "folders", path] as const,
  foldersAll: (p: string, env: string) => ["projects", p, "environments", env, "folders"] as const,
  imports: (p: string, env: string, path: string) =>
    ["projects", p, "environments", env, "imports", path] as const,
  importsAll: (p: string, env: string) => ["projects", p, "environments", env, "imports"] as const,
  keys: (p: string) => ["projects", p, "keys"] as const,
  members: (p: string) => ["projects", p, "members"] as const,
  serviceTokens: (p: string) => ["projects", p, "service-tokens"] as const,
  users: ["users"] as const,
  invites: ["invites"] as const,
  audit: (filters: AuditFilters) => ["audit", filters] as const,
  projectAudit: (p: string, filters: AuditFilters) => ["projects", p, "audit", filters] as const,
  sessions: ["sessions"] as const,
};
