/**
 * Environment names that change how programs load code, run shells or route traffic
 * (spec 2026-11-09-v0.5.3). `anchor run`, dotenv export and `loadAnchorEnv` skip secrets with
 * these names unless the caller opts in, so a folder writer cannot turn a secret into code
 * execution on the machine that consumes it. Bundled into the SDK: import nothing here.
 */
export const RESERVED_ENV_NAMES: readonly string[] = [
  "PATH",
  "IFS",
  "ENV",
  "BASH_ENV",
  "SHELLOPTS",
  "BASHOPTS",
  "PROMPT_COMMAND",
  "PS4",
  "NODE_OPTIONS",
  "NODE_PATH",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "PYTHONPATH",
  "PYTHONHOME",
  "PYTHONSTARTUP",
  "RUBYOPT",
  "RUBYLIB",
  "PERL5OPT",
  "PERL5LIB",
  "PERLLIB",
  "JAVA_TOOL_OPTIONS",
  "_JAVA_OPTIONS",
  "JDK_JAVA_OPTIONS",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_ASKPASS",
  "SSH_ASKPASS",
  "GIT_EXEC_PATH",
  "GIT_PROXY_COMMAND",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
];

/** Whole families: dynamic loaders, Anchor's own settings, git config and npm config. */
export const RESERVED_ENV_PREFIXES: readonly string[] = [
  "LD_",
  "DYLD_",
  "ANCHOR_",
  "GIT_CONFIG_",
  "NPM_CONFIG_",
];

const NAMES = new Set(RESERVED_ENV_NAMES);

/** Case-insensitive: Windows names are, and proxies are honored in lower case. */
export function isReservedEnvKey(key: string): boolean {
  const upper = key.toUpperCase();
  return NAMES.has(upper) || RESERVED_ENV_PREFIXES.some((p) => upper.startsWith(p));
}
