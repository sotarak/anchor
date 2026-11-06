import type {
  AuditEventDto,
  EnvironmentDto,
  InviteDto,
  ProjectDto,
  SecretDto,
  ServiceTokenDto,
  UserDto,
} from "@anchor/shared";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 3, 2, 12, 0, 0);

const owner: UserDto = {
  id: "u_owner",
  email: "owner@example.com",
  name: "Olivia Owner",
  role: "owner",
};
const member: UserDto = {
  id: "u_member",
  email: "member@example.com",
  name: "Max Member",
  role: "member",
};

const envs: EnvironmentDto[] = [
  { id: "e_dev", slug: "dev", name: "Development", position: 0 },
  { id: "e_staging", slug: "staging", name: "Staging", position: 1 },
  { id: "e_prod", slug: "prod", name: "Production", position: 2 },
];

const project: ProjectDto = {
  id: "p_app",
  slug: "app",
  name: "App",
  createdAt: T0,
  access: { role: "admin", environments: null },
};

/** Metadata only, as `GET /secrets` returns without reveal. */
const secrets: SecretDto[] = [
  { key: "API_KEY", path: "/", version: 2, comment: "Stripe key", updatedAt: T0 + DAY },
  { key: "DATABASE_URL", path: "/", version: 1, comment: "", updatedAt: T0 },
];

const serviceToken: ServiceTokenDto = {
  id: "st_1",
  name: "ci-deploy",
  tokenPrefix: "anc_st_ab12",
  projectSlug: "app",
  permission: "read",
  scopes: [{ environment: "prod", path: "/" }],
  createdAt: T0,
  expiresAt: T0 + 90 * DAY,
  lastUsedAt: null,
  revokedAt: null,
};

const invite: InviteDto = {
  id: "inv_1",
  email: "new@example.com",
  role: "member",
  tokenPrefix: "anc_inv_ab12",
  createdAt: T0,
  expiresAt: T0 + 3 * DAY,
  acceptedAt: null,
  revokedAt: null,
};

const auditEvents: AuditEventDto[] = [
  {
    id: "a_2",
    at: T0 + 60_000,
    actor: { type: "user", id: owner.id, label: owner.email },
    action: "secret.updated",
    projectId: project.id,
    environmentId: "e_dev",
    target: "API_KEY",
    ip: "203.0.113.7",
    userAgent: "Mozilla/5.0",
    requestId: "req_2",
    metadata: { path: "/", key: "API_KEY", version: 2 },
  },
  {
    id: "a_1",
    at: T0,
    actor: { type: "service_token", id: serviceToken.id, label: serviceToken.name },
    action: "secret.read",
    projectId: project.id,
    environmentId: "e_prod",
    target: null,
    ip: "198.51.100.1",
    userAgent: null,
    requestId: "req_1",
    metadata: { path: "/", keys: ["API_KEY"] },
  },
];

export const fixtures = {
  T0,
  DAY,
  owner,
  member,
  envs,
  project,
  secrets,
  serviceToken,
  invite,
  auditEvents,
};
