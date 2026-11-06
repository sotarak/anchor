import type { UserDto } from "@anchor/shared";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { ApiClientError } from "./api/client";
import { api } from "./api/endpoints";
import { qk } from "./api/query-keys";

export const meQueryOptions = queryOptions({
  queryKey: qk.me,
  queryFn: api.auth.me,
  staleTime: 60_000,
});

export const setupStatusQueryOptions = queryOptions({
  queryKey: qk.setupStatus,
  queryFn: api.setup.status,
});

const FALLBACK = "/projects";
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * The post-login destination: `raw` only when it is a same-origin path ("/..."), else /projects.
 * Rejects protocol-relative (`//`, `/\`), any backslash, control characters and anything that
 * resolves to another origin.
 */
export function safeRedirect(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/")) return FALLBACK;
  if (raw.startsWith("//") || raw.includes("\\") || CONTROL.test(raw)) return FALLBACK;
  try {
    if (new URL(raw, "http://x").origin !== "http://x") return FALLBACK;
  } catch {
    return FALLBACK;
  }
  return raw;
}

/**
 * Route guard for the authenticated layout. Signed out: /setup on a fresh instance, else
 * /login?redirect=<where the user was going>. Other errors propagate to the error boundary.
 */
export async function requireUser({
  context,
  location,
}: {
  context: { queryClient: QueryClient };
  location: { href: string };
}): Promise<{ me: UserDto }> {
  try {
    return { me: await context.queryClient.ensureQueryData(meQueryOptions) };
  } catch (e) {
    if (!(e instanceof ApiClientError && e.status === 401)) throw e;
    const status = await context.queryClient.fetchQuery(setupStatusQueryOptions).catch(() => null);
    if (status?.needsSetup) throw redirect({ to: "/setup" });
    throw redirect({ to: "/login", search: { redirect: location.href } });
  }
}
