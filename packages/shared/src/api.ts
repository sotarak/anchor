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

export type ProjectDto = { id: string; slug: string; name: string; createdAt: number };

export type EnvironmentDto = { id: string; slug: string; name: string; position: number };

export type SecretDto = {
  key: string;
  path: string;
  version: number;
  comment: string;
  updatedAt: number;
  value?: string;
};

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
