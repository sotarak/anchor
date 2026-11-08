import {
  type ClientOptions,
  createAnchorClient,
  isReservedEnvKey,
  type ListQuery,
} from "@anchor-secrets/sdk";

export type LoadAnchorEnvOptions = ClientOptions &
  ListQuery & {
    /** Replace variables that are already set; default `false` (the environment wins). */
    override?: boolean;
    /**
     * Also load secrets with reserved names (`NODE_OPTIONS`, `LD_PRELOAD`, `PATH`, proxies,
     * `ANCHOR_*`, ...); default `false`, so a folder writer cannot change how the process or
     * its children load code.
     */
    allowReservedKeys?: boolean;
  };

/**
 * Copies one folder of secrets into `process.env` as their stored strings, for apps that read
 * configuration from the environment (including `@nestjs/config`). Call it in `main.ts` before
 * `NestFactory.create`. Nothing is written unless the whole folder loads. Values are never
 * logged; skipped reserved names are reported once as a process warning (names only).
 */
export async function loadAnchorEnv(
  options: LoadAnchorEnvOptions,
): Promise<{ loaded: number; skipped: string[] }> {
  const secrets = await createAnchorClient(options).listSecrets(options);
  const seen = new Set<string>();
  const skipped = new Set<string>();
  let loaded = 0;
  for (const { key, value } of secrets) {
    if (seen.has(key)) continue;
    seen.add(key);
    if (!options.allowReservedKeys && isReservedEnvKey(key)) {
      skipped.add(key);
      continue;
    }
    if (!options.override && process.env[key] !== undefined) continue;
    process.env[key] = value;
    loaded++;
  }
  const names = [...skipped].sort();
  if (names.length > 0) {
    process.emitWarning(
      `Anchor skipped reserved names: ${names.join(", ")} (set allowReservedKeys to load them)`,
      "AnchorWarning",
    );
  }
  return { loaded, skipped: names };
}
