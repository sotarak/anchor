import type {
  EnvironmentDto,
  FolderDto,
  LoginResponse,
  ProjectDto,
  SecretDto,
  SecretVersionDto,
  ServiceTokenDto,
  UserDto,
} from "@anchor/shared";
import { type HttpOptions, type Method, request } from "./http";

export type CreateServiceTokenBody = {
  name: string;
  permission: "read" | "read-write";
  scopes: { environment: string; path: string }[];
  expiresInDays: number;
};

/** Read flags for secrets; omitted flags are not sent, so the server defaults apply. */
export type SecretReadFlags = { expand?: boolean; includeImports?: boolean };

export interface ApiClient {
  login(email: string, password: string): Promise<LoginResponse>;
  logout(): Promise<void>;
  me(): Promise<{ user?: UserDto; serviceToken?: ServiceTokenDto }>;
  listProjects(): Promise<ProjectDto[]>;
  getProject(slug: string): Promise<ProjectDto>;
  listEnvironments(project: string): Promise<EnvironmentDto[]>;
  listSecrets(
    project: string,
    env: string,
    q: { path: string; reveal: boolean } & SecretReadFlags,
  ): Promise<SecretDto[]>;
  getSecret(
    project: string,
    env: string,
    key: string,
    q: { path: string } & SecretReadFlags,
  ): Promise<SecretDto>;
  listVersions(
    project: string,
    env: string,
    key: string,
    q: { path: string },
  ): Promise<SecretVersionDto[]>;
  getSecretVersion(
    project: string,
    env: string,
    key: string,
    version: number,
    q: { path: string },
  ): Promise<SecretVersionDto & { value: string }>;
  rollbackSecret(
    project: string,
    env: string,
    key: string,
    body: { path: string; version: number },
  ): Promise<{ secret: SecretDto; changed: boolean }>;
  putSecret(
    project: string,
    env: string,
    key: string,
    body: { value: string; comment?: string; path: string },
  ): Promise<{ secret: SecretDto; created: boolean }>;
  deleteSecret(project: string, env: string, key: string, q: { path: string }): Promise<void>;
  listFolders(project: string, env: string, q: { path: string }): Promise<FolderDto[]>;
  createFolder(
    project: string,
    env: string,
    body: { path: string },
  ): Promise<{ folder: FolderDto; created: boolean }>;
  deleteFolder(project: string, env: string, q: { path: string; force: boolean }): Promise<void>;
  listServiceTokens(project: string): Promise<ServiceTokenDto[]>;
  createServiceToken(
    project: string,
    body: CreateServiceTokenBody,
  ): Promise<{ serviceToken: ServiceTokenDto; token: string }>;
  revokeServiceToken(project: string, id: string): Promise<void>;
}

const seg = encodeURIComponent;

export function createApiClient(opts: HttpOptions): ApiClient {
  const call = async <T>(method: Method, path: string, body?: unknown) =>
    request<T>(opts, method, `/api/v1${path}`, body);
  const data = async <T>(method: Method, path: string, body?: unknown) =>
    (await call<T>(method, path, body)).data;
  const secretsPath = (project: string, env: string) =>
    `/projects/${seg(project)}/environments/${seg(env)}/secrets`;
  const foldersPath = (project: string, env: string) =>
    `/projects/${seg(project)}/environments/${seg(env)}/folders`;
  const query = (q: Record<string, string | boolean | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined) params.set(k, String(v));
    return `?${params}`;
  };

  return {
    login: (email, password) =>
      data<LoginResponse>("POST", "/auth/login", { email, password, client: "cli" }),
    logout: async () => {
      await call("POST", "/auth/logout");
    },
    me: () => data("GET", "/auth/me"),
    listProjects: async () => (await data<{ projects: ProjectDto[] }>("GET", "/projects")).projects,
    getProject: async (slug) =>
      (await data<{ project: ProjectDto }>("GET", `/projects/${seg(slug)}`)).project,
    listEnvironments: async (project) =>
      (
        await data<{ environments: EnvironmentDto[] }>(
          "GET",
          `/projects/${seg(project)}/environments`,
        )
      ).environments,
    listSecrets: async (project, env, q) =>
      (
        await data<{ secrets: SecretDto[] }>(
          "GET",
          secretsPath(project, env) +
            query({
              path: q.path,
              reveal: q.reveal,
              expand: q.expand,
              includeImports: q.includeImports,
            }),
        )
      ).secrets,
    getSecret: async (project, env, key, q) =>
      (
        await data<{ secret: SecretDto }>(
          "GET",
          `${secretsPath(project, env)}/${seg(key)}${query({
            path: q.path,
            expand: q.expand,
            includeImports: q.includeImports,
          })}`,
        )
      ).secret,
    listVersions: async (project, env, key, q) =>
      (
        await data<{ versions: SecretVersionDto[] }>(
          "GET",
          `${secretsPath(project, env)}/${seg(key)}/versions${query({ path: q.path })}`,
        )
      ).versions,
    getSecretVersion: async (project, env, key, version, q) =>
      (
        await data<{ version: SecretVersionDto & { value: string } }>(
          "GET",
          `${secretsPath(project, env)}/${seg(key)}/versions/${version}${query({ path: q.path })}`,
        )
      ).version,
    rollbackSecret: (project, env, key, body) =>
      data("POST", `${secretsPath(project, env)}/${seg(key)}/rollback`, body),
    putSecret: async (project, env, key, body) => {
      const res = await call<{ secret: SecretDto }>(
        "PUT",
        `${secretsPath(project, env)}/${seg(key)}`,
        body,
      );
      return { secret: res.data.secret, created: res.status === 201 };
    },
    deleteSecret: async (project, env, key, q) => {
      await call("DELETE", `${secretsPath(project, env)}/${seg(key)}${query({ path: q.path })}`);
    },
    listFolders: async (project, env, q) =>
      (
        await data<{ folders: FolderDto[] }>(
          "GET",
          `${foldersPath(project, env)}${query({ path: q.path })}`,
        )
      ).folders,
    createFolder: async (project, env, body) => {
      const res = await call<{ folder: FolderDto }>("POST", foldersPath(project, env), body);
      return { folder: res.data.folder, created: res.status === 201 };
    },
    deleteFolder: async (project, env, q) => {
      await call("DELETE", `${foldersPath(project, env)}${query(q)}`);
    },
    listServiceTokens: async (project) =>
      (
        await data<{ serviceTokens: ServiceTokenDto[] }>(
          "GET",
          `/projects/${seg(project)}/service-tokens`,
        )
      ).serviceTokens,
    createServiceToken: (project, body) =>
      data("POST", `/projects/${seg(project)}/service-tokens`, body),
    revokeServiceToken: async (project, id) => {
      await call("DELETE", `/projects/${seg(project)}/service-tokens/${seg(id)}`);
    },
  };
}
