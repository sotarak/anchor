import type { AuditAction } from "./audit";

export type InstanceRole = "owner" | "admin" | "member";

export type UserDto = {
  id: string;
  email: string;
  name: string;
  role: InstanceRole;
  disabledAt?: number | null;
};

export type ProjectRole = "admin" | "developer" | "viewer";

/** The calling user's effective access to a project. Instance owners/admins map to admin/null. */
export type ProjectAccessDto = {
  role: ProjectRole;
  /** Environment slugs the user may read, or null for every environment. */
  environments: string[] | null;
};

export type ProjectDto = {
  id: string;
  slug: string;
  name: string;
  createdAt: number;
  /** Present for user principals on GET /projects and GET /projects/:project. */
  access?: ProjectAccessDto;
};

export type EnvironmentDto = { id: string; slug: string; name: string; position: number };

/** Which keys exist in which environments at one path. Never carries values. */
export type OverviewDto = {
  environments: EnvironmentDto[];
  keys: {
    key: string;
    /** Keyed by environment slug; null when the key is absent there. */
    cells: Record<string, { version: number; updatedAt: number } | null>;
  }[];
};

export type SecretDto = {
  key: string;
  path: string;
  version: number;
  comment: string;
  updatedAt: number;
  value?: string;
  /** The stored value, present only when `value` was expanded and differs from it (M5). */
  rawValue?: string;
  /** Set on a secret that comes from a folder import; it is read-only here (M5). */
  importedFrom?: { environment: string; path: string };
};

/** One stored version of a secret, without its value (spec §13.5). */
export type SecretVersionDto = {
  version: number;
  comment: string;
  createdAt: number;
  createdBy: { id: string; label: string } | null;
};

/** A folder that imports the secrets stored directly at another (environment, path). */
export type FolderImportDto = {
  id: string;
  path: string;
  source: { environment: string; path: string };
  position: number;
};

/** A project key (KEK) version. "retiring" keys still decrypt until re-encryption finishes. */
export type ProjectKeyDto = {
  version: number;
  status: "active" | "retiring" | "retired";
  rootKeyId: string;
  createdAt: number;
};

/** A KEK rotation (spec §13.5). `error` is a short code when status is "failed". */
export type KeyRotationDto = {
  id: string;
  fromVersion: number;
  toVersion: number;
  status: "running" | "completed" | "failed";
  total: number;
  done: number;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
};

/** A direct child folder (spec §13.5). */
export type FolderDto = { path: string; name: string };

export type LoginResponse = { user: UserDto; token?: string; expiresAt: number };

export type SetupStatusDto = { needsSetup: boolean };

export type SessionDto = {
  /** First 16 hex chars of the stored session id hash, never the hash itself. */
  id: string;
  kind: "web" | "cli";
  userAgent: string | null;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number;
  current: boolean;
};

export type InviteDto = {
  id: string;
  email: string;
  role: InstanceRole;
  tokenPrefix: string;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number | null;
  revokedAt: number | null;
};

export type MemberDto = {
  userId: string;
  email: string;
  name: string;
  role: ProjectRole;
  environments: string[] | null;
};

export type ServiceTokenDto = {
  id: string;
  name: string;
  tokenPrefix: string;
  projectSlug: string;
  permission: "read" | "read-write";
  scopes: { environment: string; path: string }[];
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
};

export type AuditEventDto = {
  id: string;
  at: number;
  actor: { type: "user" | "service_token" | "anonymous"; id: string | null; label: string | null };
  action: AuditAction;
  projectId: string | null;
  environmentId: string | null;
  target: string | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  metadata: Record<string, unknown>;
};
