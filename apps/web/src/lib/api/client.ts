import type { ApiErrorBody, ErrorCode } from "@anchor/shared";

export type ClientErrorCode = ErrorCode | "network_error" | "invalid_response";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: ClientErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/** Endpoints whose 401 is an expected answer (login form, guard probe), never "session expired". */
export const AUTH_PATHS = [
  "/auth/me",
  "/auth/login",
  "/auth/logout",
  "/setup",
  "/setup/status",
  "/invites/inspect",
  "/invites/accept",
  "/auth/password-reset",
];

let onUnauthenticated: () => void = () => {};

/** Called when a non-auth request answers 401 unauthenticated (the session expired mid-use). */
export function setUnauthenticatedHandler(fn: () => void): void {
  onUnauthenticated = fn;
}

type Query = Record<string, string | number | boolean | undefined>;

export async function apiFetch<T>(
  path: string,
  init: { method?: string; body?: unknown; query?: Query } = {},
): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v !== undefined) params.set(k, String(v));
  }
  const qs = params.toString();
  const url = `/api/v1${path}${qs ? `?${qs}` : ""}`;
  const hasBody = init.body !== undefined;
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers: hasBody ? { "content-type": "application/json" } : undefined,
      body: hasBody ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiClientError(
      0,
      "network_error",
      "Could not reach the server. Check your connection.",
    );
  }
  if (res.status === 204) return undefined as T;
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new ApiClientError(res.status, "invalid_response", `Unexpected response (${res.status})`);
  }
  if (!res.ok) {
    const error = (data as Partial<ApiErrorBody> | null)?.error;
    if (!error || typeof error.code !== "string") {
      throw new ApiClientError(
        res.status,
        "invalid_response",
        `Unexpected response (${res.status})`,
      );
    }
    // Only "unauthenticated" means the session is gone; a 401 invalid_credentials (wrong current
    // password) must not log the user out.
    if (res.status === 401 && error.code === "unauthenticated" && !AUTH_PATHS.includes(path)) {
      onUnauthenticated();
    }
    throw new ApiClientError(res.status, error.code, error.message);
  }
  return data as T;
}
