import { describe, expect, it } from "vitest";
import { isReservedEnvKey, RESERVED_ENV_NAMES, RESERVED_ENV_PREFIXES } from "../src/env-keys";

describe("isReservedEnvKey", () => {
  it.each([
    "NODE_OPTIONS",
    "node_options",
    "Path",
    "LD_PRELOAD",
    "DYLD_INSERT_LIBRARIES",
    "ANCHOR_API_URL",
    "GIT_CONFIG_COUNT",
    "npm_config_script_shell",
    "http_proxy",
    "_JAVA_OPTIONS",
  ])("%s is reserved", (k) => expect(isReservedEnvKey(k)).toBe(true));

  it.each(["DATABASE_URL", "PATHNAME", "MY_PATH", "NODE_ENV", "LDAP_URL", "ANCHORAGE"])(
    "%s is not reserved",
    (k) => expect(isReservedEnvKey(k)).toBe(false),
  );

  it("every listed name and prefix is upper case", () => {
    for (const n of [...RESERVED_ENV_NAMES, ...RESERVED_ENV_PREFIXES]) {
      expect(n).toBe(n.toUpperCase());
    }
    for (const p of RESERVED_ENV_PREFIXES) expect(p.endsWith("_")).toBe(true);
  });
});
