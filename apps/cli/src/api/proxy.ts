/**
 * Proxy support for Node (Bun's fetch reads HTTP(S)_PROXY / NO_PROXY itself).
 *
 * Node 22 can honor proxy variables natively only when started with NODE_USE_ENV_PROXY=1
 * (or --use-env-proxy), which a `#!/usr/bin/env node` bin cannot turn on after startup.
 * So when a proxy variable is set we return undici's own `fetch` bound to an
 * EnvHttpProxyAgent: the fetch and the dispatcher come from the same package, so they cannot
 * disagree across Node's bundled undici versions.
 */
export async function configureProxyFromEnv(
  env: Record<string, string | undefined>,
): Promise<typeof fetch | undefined> {
  if ("Bun" in globalThis) return undefined;
  if (env.NODE_USE_ENV_PROXY === "1") return undefined;
  const proxy = env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy ?? undefined;
  if (!proxy) return undefined;
  const undici = await import("undici");
  const dispatcher = new undici.EnvHttpProxyAgent();
  return ((input: Parameters<typeof undici.fetch>[0], init?: Parameters<typeof undici.fetch>[1]) =>
    undici.fetch(input, { ...init, dispatcher })) as unknown as typeof fetch;
}
