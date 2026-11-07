// Starts the real Worker (API + built dashboard assets) for the Playwright smoke.
//
// Runs as Playwright's webServer command. Playwright starts webServer *before* globalSetup, so the
// fresh D1 state and its migrations are prepared here, in order, before `wrangler dev` boots.
// Secrets go through a throwaway --env-file inside the git-ignored state dir: never argv, and never
// the root .dev.vars (wrangler skips .dev.vars when --env-file is given).
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const state = fileURLToPath(new URL("./.state", import.meta.url));
// wrangler runs from the repository root, where wrangler.jsonc lives.
const root = fileURLToPath(new URL("../../../..", import.meta.url));
const envFile = `${state}/e2e.env`;
const port = process.env.E2E_PORT ?? "8788";
const { E2E_ROOT_KEY } = process.env;
if (!E2E_ROOT_KEY) {
  console.error("serve.mjs: E2E_ROOT_KEY must be set (playwright.config.ts)");
  process.exit(1);
}

rmSync(state, { recursive: true, force: true });
mkdirSync(state, { recursive: true });
writeFileSync(envFile, `ANCHOR_ROOT_KEY=${E2E_ROOT_KEY}\n`, { mode: 0o600 });
chmodSync(envFile, 0o600);

const wrangler = (args, opts) => [
  "pnpm",
  ["exec", "wrangler", ...args],
  { cwd: root, stdio: "inherit", ...opts },
];

const migrate = spawnSync(
  ...wrangler(["d1", "migrations", "apply", "DB", "--local", "--persist-to", state]),
);
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const dev = spawn(
  ...wrangler([
    "dev",
    "--port",
    port,
    "--persist-to",
    state,
    "--env-file",
    envFile,
    "--show-interactive-dev-session=false",
  ]),
);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => dev.kill(signal));
}
dev.on("exit", (code, signal) => {
  rmSync(envFile, { force: true });
  process.exit(code ?? (signal ? 1 : 0));
});
