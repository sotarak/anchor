import { type ClientOptions, createAnchorClient, type ListQuery } from "@anchor-secrets/sdk";

export type LoadAnchorEnvOptions = ClientOptions &
  ListQuery & {
    /** Replace variables that are already set; default `false` (the environment wins). */
    override?: boolean;
  };

/**
 * Copies one folder of secrets into `process.env` as their stored strings, for apps that read
 * configuration from the environment (including `@nestjs/config`). Call it in `main.ts` before
 * `NestFactory.create`. Nothing is written unless the whole folder loads; nothing is logged.
 */
export async function loadAnchorEnv(options: LoadAnchorEnvOptions): Promise<{ loaded: number }> {
  const secrets = await createAnchorClient(options).listSecrets(options);
  const seen = new Set<string>();
  let loaded = 0;
  for (const { key, value } of secrets) {
    if (seen.has(key)) continue;
    seen.add(key);
    if (!options.override && process.env[key] !== undefined) continue;
    process.env[key] = value;
    loaded++;
  }
  return { loaded };
}
