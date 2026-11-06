import { env, exports } from "cloudflare:workers";

export const TEST_ORIGIN = "http://anchor.test";

export function api(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(TEST_ORIGIN + path, init));
}

export async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

const TABLES_CHILD_FIRST = [
  "secret_versions",
  "secrets",
  "environments",
  "project_keys",
  "projects",
  "sessions",
  "users",
];

/** Empties every table. Tests must not assume isolated storage between files. */
export async function resetDb(): Promise<void> {
  await env.DB.batch(TABLES_CHILD_FIRST.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
}
