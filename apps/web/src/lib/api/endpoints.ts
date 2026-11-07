import type {
  AuditAction,
  AuditEventDto,
  EnvironmentDto,
  FolderDto,
  FolderImportDto,
  InstanceRole,
  InviteDto,
  KeyRotationDto,
  LoginResponse,
  MemberDto,
  OverviewDto,
  ProjectDto,
  ProjectKeyDto,
  ProjectRole,
  SecretDto,
  SecretVersionDto,
  ServiceTokenDto,
  SessionDto,
  SetupStatusDto,
  UserDto,
} from "@anchor/shared";
import { apiFetch } from "./client";

const e = encodeURIComponent;
const projectUrl = (p: string) => `/projects/${e(p)}`;
const envUrl = (p: string, env: string) => `${projectUrl(p)}/environments/${e(env)}`;

export type AuditFilters = {
  projectId?: string;
  actorId?: string;
  action?: AuditAction;
  before?: string;
  limit?: number;
};
export type AuditPage = { events: AuditEventDto[]; nextCursor: string | null };

/**
 * One typed function per endpoint the dashboard uses. Only `secrets.get` and
 * `secrets.versionValue` return a value; neither is ever wrapped in useQuery.
 */
export const api = {
  setup: {
    status: () => apiFetch<SetupStatusDto>("/setup/status"),
    submit: (body: { email: string; name: string; password: string }) =>
      apiFetch<LoginResponse>("/setup", { method: "POST", body }),
  },
  auth: {
    me: async () => (await apiFetch<{ user: UserDto }>("/auth/me")).user,
    login: (body: { email: string; password: string }) =>
      apiFetch<LoginResponse>("/auth/login", { method: "POST", body: { ...body, client: "web" } }),
    logout: () => apiFetch<void>("/auth/logout", { method: "POST" }),
    changePassword: (body: { currentPassword: string; newPassword: string }) =>
      apiFetch<void>("/auth/password", { method: "POST", body }),
    sessions: async () => (await apiFetch<{ sessions: SessionDto[] }>("/auth/sessions")).sessions,
    revokeSession: (id: string) => apiFetch<void>(`/auth/sessions/${e(id)}`, { method: "DELETE" }),
    resetPassword: (body: { token: string; password: string }) =>
      apiFetch<void>("/auth/password-reset", { method: "POST", body }),
  },
  invites: {
    list: async () => (await apiFetch<{ invites: InviteDto[] }>("/invites")).invites,
    create: (body: { email: string; role: InstanceRole }) =>
      apiFetch<{ invite: InviteDto; url: string }>("/invites", { method: "POST", body }),
    revoke: (id: string) => apiFetch<void>(`/invites/${e(id)}`, { method: "DELETE" }),
    inspect: (token: string) =>
      apiFetch<{ email: string; role: InstanceRole }>("/invites/inspect", {
        method: "POST",
        body: { token },
      }),
    accept: (body: { token: string; name: string; password: string }) =>
      apiFetch<LoginResponse>("/invites/accept", { method: "POST", body }),
  },
  users: {
    list: async () => (await apiFetch<{ users: UserDto[] }>("/users")).users,
    update: async (id: string, body: { role?: InstanceRole; disabled?: boolean }) =>
      (await apiFetch<{ user: UserDto }>(`/users/${e(id)}`, { method: "PATCH", body })).user,
    remove: (id: string) => apiFetch<void>(`/users/${e(id)}`, { method: "DELETE" }),
    createPasswordReset: (id: string) =>
      apiFetch<{ url: string; expiresAt: number }>(`/users/${e(id)}/password-reset`, {
        method: "POST",
      }),
  },
  projects: {
    list: async () => (await apiFetch<{ projects: ProjectDto[] }>("/projects")).projects,
    get: async (p: string) => (await apiFetch<{ project: ProjectDto }>(projectUrl(p))).project,
    create: async (body: { name: string; slug: string }) =>
      (await apiFetch<{ project: ProjectDto }>("/projects", { method: "POST", body })).project,
    update: async (p: string, body: { name: string }) =>
      (await apiFetch<{ project: ProjectDto }>(projectUrl(p), { method: "PATCH", body })).project,
    remove: (p: string) => apiFetch<void>(projectUrl(p), { method: "DELETE" }),
    overview: (p: string, path: string) =>
      apiFetch<OverviewDto>(`${projectUrl(p)}/overview`, { query: { path } }),
  },
  environments: {
    list: async (p: string) =>
      (await apiFetch<{ environments: EnvironmentDto[] }>(`${projectUrl(p)}/environments`))
        .environments,
    create: async (p: string, body: { name: string; slug: string }) =>
      (
        await apiFetch<{ environment: EnvironmentDto }>(`${projectUrl(p)}/environments`, {
          method: "POST",
          body,
        })
      ).environment,
    update: async (p: string, env: string, body: { name: string }) =>
      (await apiFetch<{ environment: EnvironmentDto }>(envUrl(p, env), { method: "PATCH", body }))
        .environment,
    remove: (p: string, env: string) => apiFetch<void>(envUrl(p, env), { method: "DELETE" }),
  },
  secrets: {
    /** Metadata only: never sends reveal=true. */
    list: async (p: string, env: string, path: string, opts: { includeImports?: boolean } = {}) =>
      (
        await apiFetch<{ secrets: SecretDto[] }>(`${envUrl(p, env)}/secrets`, {
          query: { path, includeImports: opts.includeImports },
        })
      ).secrets,
    /** The one value-returning call. Never wrap it in useQuery. */
    get: async (
      p: string,
      env: string,
      key: string,
      path: string,
      opts: { expand?: boolean; includeImports?: boolean } = {},
    ) =>
      (
        await apiFetch<{ secret: SecretDto }>(`${envUrl(p, env)}/secrets/${e(key)}`, {
          query: { path, expand: opts.expand, includeImports: opts.includeImports },
        })
      ).secret,
    put: async (
      p: string,
      env: string,
      key: string,
      body: { value: string; comment: string; path: string },
    ) =>
      (
        await apiFetch<{ secret: SecretDto }>(`${envUrl(p, env)}/secrets/${e(key)}`, {
          method: "PUT",
          body,
        })
      ).secret,
    remove: (p: string, env: string, key: string, path: string) =>
      apiFetch<void>(`${envUrl(p, env)}/secrets/${e(key)}`, { method: "DELETE", query: { path } }),
    /** Version metadata only. */
    versions: async (p: string, env: string, key: string, path: string) =>
      (
        await apiFetch<{ versions: SecretVersionDto[] }>(
          `${envUrl(p, env)}/secrets/${e(key)}/versions`,
          { query: { path } },
        )
      ).versions,
    /** A past version's value (audited). Never wrap it in useQuery. */
    versionValue: async (p: string, env: string, key: string, version: number, path: string) =>
      (
        await apiFetch<{ version: SecretVersionDto & { value: string } }>(
          `${envUrl(p, env)}/secrets/${e(key)}/versions/${version}`,
          { query: { path } },
        )
      ).version.value,
    rollback: (p: string, env: string, key: string, body: { path: string; version: number }) =>
      apiFetch<{ secret: SecretDto; changed: boolean }>(
        `${envUrl(p, env)}/secrets/${e(key)}/rollback`,
        { method: "POST", body },
      ),
  },
  folders: {
    list: async (p: string, env: string, path: string) =>
      (await apiFetch<{ folders: FolderDto[] }>(`${envUrl(p, env)}/folders`, { query: { path } }))
        .folders,
    create: async (p: string, env: string, path: string) =>
      (
        await apiFetch<{ folder: FolderDto }>(`${envUrl(p, env)}/folders`, {
          method: "POST",
          body: { path },
        })
      ).folder,
    remove: (p: string, env: string, path: string, force: boolean) =>
      apiFetch<void>(`${envUrl(p, env)}/folders`, { method: "DELETE", query: { path, force } }),
  },
  imports: {
    list: async (p: string, env: string, path: string) =>
      (
        await apiFetch<{ imports: FolderImportDto[] }>(`${envUrl(p, env)}/imports`, {
          query: { path },
        })
      ).imports,
    create: async (
      p: string,
      env: string,
      body: { path: string; source: { environment: string; path: string } },
    ) =>
      (
        await apiFetch<{ import: FolderImportDto }>(`${envUrl(p, env)}/imports`, {
          method: "POST",
          body,
        })
      ).import,
    remove: (p: string, env: string, id: string) =>
      apiFetch<void>(`${envUrl(p, env)}/imports/${e(id)}`, { method: "DELETE" }),
  },
  keys: {
    status: (p: string) =>
      apiFetch<{ keys: ProjectKeyDto[]; rotations: KeyRotationDto[] }>(`${projectUrl(p)}/keys`),
    rotate: async (p: string) =>
      (
        await apiFetch<{ rotation: KeyRotationDto }>(`${projectUrl(p)}/keys/rotate`, {
          method: "POST",
        })
      ).rotation,
  },
  members: {
    list: async (p: string) =>
      (await apiFetch<{ members: MemberDto[] }>(`${projectUrl(p)}/members`)).members,
    add: async (
      p: string,
      body: { email: string; role: ProjectRole; environments: string[] | null },
    ) =>
      (await apiFetch<{ member: MemberDto }>(`${projectUrl(p)}/members`, { method: "POST", body }))
        .member,
    update: async (
      p: string,
      userId: string,
      body: { role?: ProjectRole; environments?: string[] | null },
    ) =>
      (
        await apiFetch<{ member: MemberDto }>(`${projectUrl(p)}/members/${e(userId)}`, {
          method: "PATCH",
          body,
        })
      ).member,
    remove: (p: string, userId: string) =>
      apiFetch<void>(`${projectUrl(p)}/members/${e(userId)}`, { method: "DELETE" }),
  },
  serviceTokens: {
    list: async (p: string) =>
      (await apiFetch<{ serviceTokens: ServiceTokenDto[] }>(`${projectUrl(p)}/service-tokens`))
        .serviceTokens,
    create: (
      p: string,
      body: {
        name: string;
        permission: "read" | "read-write";
        scopes: { environment: string; path: string }[];
        expiresInDays: number;
      },
    ) =>
      apiFetch<{ serviceToken: ServiceTokenDto; token: string }>(
        `${projectUrl(p)}/service-tokens`,
        { method: "POST", body },
      ),
    revoke: (p: string, id: string) =>
      apiFetch<void>(`${projectUrl(p)}/service-tokens/${e(id)}`, { method: "DELETE" }),
  },
  audit: {
    list: (filters: AuditFilters) => apiFetch<AuditPage>("/audit", { query: filters }),
    listForProject: (p: string, filters: Omit<AuditFilters, "projectId">) =>
      apiFetch<AuditPage>(`${projectUrl(p)}/audit`, { query: filters }),
  },
};
