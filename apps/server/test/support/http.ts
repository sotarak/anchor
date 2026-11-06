import { exports } from "cloudflare:workers";

export const TEST_ORIGIN = "http://anchor.test";

/** Sends a request through the Worker's real fetch handler. */
export function api(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(TEST_ORIGIN + path, init));
}

export async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** JSON request init with cookie or bearer auth. Cookie requests get Origin unless origin: null. */
export function jsonInit(
  method: string,
  body: unknown,
  auth: { cookie?: string; token?: string; origin?: string | null } = {},
): RequestInit {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth.token) headers.authorization = `Bearer ${auth.token}`;
  if (auth.cookie) {
    headers.cookie = auth.cookie;
    const origin = auth.origin === undefined ? TEST_ORIGIN : auth.origin;
    if (origin !== null) headers.origin = origin;
  } else if (auth.origin) {
    headers.origin = auth.origin;
  }
  return { method, headers, body: body === undefined ? undefined : JSON.stringify(body) };
}
