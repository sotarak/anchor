import { emitSafely, resolveConfig } from "./config.js";
import { decodeAll, toSecret, type WireSecret } from "./decode.js";
import { AnchorError } from "./errors.js";
import { withRetry } from "./retry.js";
import { fetchJson } from "./transport.js";
import type { AnchorClient, AnchorSecret, ClientOptions, ListQuery } from "./types.js";

export function createAnchorClient(options: ClientOptions = {}): AnchorClient {
  const listSecrets = async (q: ListQuery): Promise<AnchorSecret[]> => {
    const cfg = resolveConfig(options);
    const params = new URLSearchParams({
      path: q.path ?? "/",
      reveal: "true",
      expand: String(q.expand ?? true),
      includeImports: String(q.includeImports ?? true),
    });
    const url = `${cfg.base}/api/v1/projects/${encodeURIComponent(q.project)}/environments/${encodeURIComponent(q.environment)}/secrets?${params}`;
    const body = (await withRetry(() => fetchJson(cfg, url), cfg.retry, {
      emit: (event) => emitSafely(cfg.onEvent, event),
    })) as { secrets?: unknown } | null;
    if (!body || !Array.isArray(body.secrets)) {
      throw new AnchorError(200, "bad_response", "Anchor returned an unexpected response");
    }
    return (body.secrets as WireSecret[]).map(toSecret);
  };

  return {
    listSecrets,
    async loadSecrets(q) {
      return decodeAll(await listSecrets(q));
    },
  };
}
