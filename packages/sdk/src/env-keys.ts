import { isReservedEnvKey as reserved } from "@anchor/shared/env-keys";

/**
 * True for environment names that change how programs load code or route traffic
 * (`NODE_OPTIONS`, `LD_PRELOAD`, `PATH`, proxies, `ANCHOR_*`, ...), case-insensitively. Use it
 * before copying secrets into an environment; `@anchor-secrets/nestjs` does.
 */
export function isReservedEnvKey(key: string): boolean {
  return reserved(key);
}
