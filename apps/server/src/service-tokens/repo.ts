import type { ServiceTokenDto } from "@anchor/shared";
import type { ServiceTokenPrincipal } from "../env";
import { newId, newToken, sha256Hex, tokenPrefix } from "../lib/random";

export type ServiceTokenRow = {
  id: string;
  project_id: string;
  name: string;
  token_hash: string;
  token_prefix: string;
  permission: "read" | "read-write";
  scopes: string;
  created_by: string | null;
  created_at: number;
  expires_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
};

export type TokenScope = { environmentId: string; path: string };

const TOKEN_PREFIX = "anc_st_";
const LAST_USED_THROTTLE_MS = 60_000;

function parseScopes(raw: string): TokenScope[] {
  return JSON.parse(raw) as TokenScope[];
}

export async function createServiceToken(
  db: D1Database,
  input: {
    projectId: string;
    name: string;
    permission: "read" | "read-write";
    scopes: TokenScope[];
    expiresAt: number;
    createdBy: string;
  },
  now: number,
): Promise<{ row: ServiceTokenRow; token: string }> {
  const token = newToken("anc_st");
  const row: ServiceTokenRow = {
    id: newId(),
    project_id: input.projectId,
    name: input.name,
    token_hash: await sha256Hex(token),
    token_prefix: tokenPrefix(token),
    permission: input.permission,
    scopes: JSON.stringify(input.scopes),
    created_by: input.createdBy,
    created_at: now,
    expires_at: input.expiresAt,
    last_used_at: null,
    revoked_at: null,
  };
  await db
    .prepare(
      `INSERT INTO service_tokens (id, project_id, name, token_hash, token_prefix, permission,
         scopes, created_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.project_id,
      row.name,
      row.token_hash,
      row.token_prefix,
      row.permission,
      row.scopes,
      row.created_by,
      row.created_at,
      row.expires_at,
    )
    .run();
  return { row, token };
}

/** Resolves a bearer service token; null when unknown, revoked or expired. No caching. */
export async function findPrincipalByServiceToken(
  db: D1Database,
  token: string,
  now: number,
): Promise<ServiceTokenPrincipal | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const row = await db
    .prepare(
      "SELECT * FROM service_tokens WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?",
    )
    .bind(await sha256Hex(token), now)
    .first<ServiceTokenRow>();
  if (!row) return null;
  if (row.last_used_at === null || row.last_used_at < now - LAST_USED_THROTTLE_MS) {
    await db
      .prepare(
        "UPDATE service_tokens SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)",
      )
      .bind(now, row.id, now - LAST_USED_THROTTLE_MS)
      .run();
  }
  return {
    type: "service_token",
    tokenId: row.id,
    projectId: row.project_id,
    name: row.name,
    permission: row.permission,
    scopes: parseScopes(row.scopes),
    expiresAt: row.expires_at,
  };
}

export async function listServiceTokens(
  db: D1Database,
  projectId: string,
): Promise<ServiceTokenRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM service_tokens WHERE project_id = ? ORDER BY created_at DESC, id DESC")
    .bind(projectId)
    .all<ServiceTokenRow>();
  return results;
}

export function getServiceToken(db: D1Database, id: string): Promise<ServiceTokenRow | null> {
  return db.prepare("SELECT * FROM service_tokens WHERE id = ?").bind(id).first<ServiceTokenRow>();
}

/**
 * Revokes a token of this project. Returns "revoked" the first time, "already" when it was
 * revoked before, and "not_found" for unknown ids or tokens of another project.
 */
export async function revokeServiceToken(
  db: D1Database,
  projectId: string,
  id: string,
  now: number,
): Promise<"revoked" | "already" | "not_found"> {
  const result = await db
    .prepare(
      "UPDATE service_tokens SET revoked_at = ? WHERE id = ? AND project_id = ? AND revoked_at IS NULL",
    )
    .bind(now, id, projectId)
    .run();
  if (result.meta.changes === 1) return "revoked";
  const row = await getServiceToken(db, id);
  return row && row.project_id === projectId ? "already" : "not_found";
}

/** Scopes whose environment no longer exists are dropped (a recreated slug is a new env). */
export function toServiceTokenDto(
  row: ServiceTokenRow,
  projectSlug: string,
  envSlugById: Map<string, string>,
): ServiceTokenDto {
  const scopes = parseScopes(row.scopes).flatMap((s) => {
    const environment = envSlugById.get(s.environmentId);
    return environment ? [{ environment, path: s.path }] : [];
  });
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    projectSlug,
    permission: row.permission,
    scopes,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

/** The DTO for one token, loading its project slug and environment names. */
export async function loadServiceTokenDto(
  db: D1Database,
  tokenId: string,
): Promise<ServiceTokenDto | null> {
  const row = await getServiceToken(db, tokenId);
  if (!row) return null;
  const [project, envs] = await Promise.all([
    db
      .prepare("SELECT slug FROM projects WHERE id = ?")
      .bind(row.project_id)
      .first<{ slug: string }>(),
    db
      .prepare("SELECT id, slug FROM environments WHERE project_id = ?")
      .bind(row.project_id)
      .all<{ id: string; slug: string }>(),
  ]);
  if (!project) return null;
  return toServiceTokenDto(row, project.slug, new Map(envs.results.map((e) => [e.id, e.slug])));
}
