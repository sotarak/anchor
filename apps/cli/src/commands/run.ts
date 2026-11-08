import type { SecretDto } from "@anchor/shared";
import type { ApiClient } from "../api/client";
import { positionals } from "../argv";
import { authedApi } from "../auth";
import {
  type ChildHandle,
  type CommandContext,
  requireProject,
  type Sleep,
  timerSleep,
} from "../context";
import { CliError, EXIT, withExpandHint } from "../errors";
import { exitCodeFromChild } from "../process/run-child";

/** Parent env plus secrets. By default Anchor values win; with override=false existing vars win. */
export function buildChildEnv(
  parent: Record<string, string | undefined>,
  secrets: SecretDto[],
  override: boolean,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(parent)) if (v !== undefined) env[k] = v;
  for (const s of secrets) {
    if (s.value === undefined) continue;
    if (override || !(s.key in env)) env[s.key] = s.value;
  }
  return env;
}

const RUN_USAGE = "Usage: anchor run [options] -- <command> [args...]";

export const WATCH_INTERVAL_DEFAULT_S = 30;
export const WATCH_INTERVAL_MIN_S = 5;
/** How long a child has to exit after SIGTERM before it gets SIGKILL. */
export const RESTART_GRACE_MS = 10_000;

/** `--watch-interval` as milliseconds; anything but an integer of at least 5 is a usage error. */
export function watchIntervalMs(watch: boolean, raw: string | undefined): number | undefined {
  if (raw !== undefined && !watch) {
    throw new CliError(EXIT.USAGE, "--watch-interval needs --watch", RUN_USAGE);
  }
  if (!watch) return undefined;
  if (raw === undefined) return WATCH_INTERVAL_DEFAULT_S * 1000;
  if (!/^\d+$/.test(raw) || Number(raw) < WATCH_INTERVAL_MIN_S) {
    throw new CliError(
      EXIT.USAGE,
      `--watch-interval must be a whole number of seconds, at least ${WATCH_INTERVAL_MIN_S}`,
      RUN_USAGE,
    );
  }
  return Number(raw) * 1000;
}

const sameEnv = (a: Record<string, string>, b: Record<string, string>) => {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && a[k] === b[k])
  );
};

/**
 * `anchor run` takes its command only after `--`. Without it, flags meant for the child
 * (`--env prod`) would silently be parsed as Anchor's own, so this exits 2 instead.
 */
export function assertRunSeparator(argv: string[]): void {
  const [first, ...rest] = positionals(argv);
  if (first?.value !== "run" || first.afterDashDash) return;
  if (rest.some((p) => !p.afterDashDash)) {
    throw new CliError(EXIT.USAGE, "Put the command after --", RUN_USAGE);
  }
}

/**
 * Fetches secrets, then runs the command with them in its environment. Any fetch failure is
 * thrown before the child starts (fail closed). Returns the child's exit code.
 */
export async function runCommand(
  ctx: CommandContext,
  argv: string[],
  opts: { override: boolean; expand: boolean; watch?: { intervalMs: number } },
): Promise<number> {
  const [cmd, ...args] = argv;
  if (!cmd) {
    throw new CliError(EXIT.USAGE, "Missing command", RUN_USAGE);
  }
  const project = requireProject(ctx);
  const { api } = await authedApi(ctx);
  if (opts.watch) return watchCommand(ctx, api, project, cmd, args, opts, opts.watch.intervalMs);
  const secrets = await withExpandHint(
    opts.expand,
    api.listSecrets(project, ctx.config.env.value, {
      path: ctx.config.path.value,
      reveal: true,
      expand: opts.expand,
      includeImports: true,
    }),
  );
  const env = buildChildEnv(ctx.deps.io.env, secrets, opts.override);
  ctx.out.debug(`injecting ${secrets.length} secrets into ${cmd}`);
  return exitCodeFromChild(await ctx.deps.runChild(cmd, args, env));
}

type Exit = { code: number | null; signal: NodeJS.Signals | null };

/**
 * `run --watch`: the first fetch is fail-closed like `run`; then, every interval, a conditional
 * fetch restarts the child (SIGTERM, SIGKILL after RESTART_GRACE_MS) only when its environment
 * would differ. A failed check keeps the child running. The watch ends when the child exits on
 * its own, with the child's code. Keys and values never reach the output.
 */
async function watchCommand(
  ctx: CommandContext,
  api: ApiClient,
  project: string,
  cmd: string,
  args: string[],
  opts: { override: boolean; expand: boolean },
  intervalMs: number,
): Promise<number> {
  const sleep = ctx.deps.sleep ?? timerSleep;
  const query = {
    path: ctx.config.path.value,
    reveal: true,
    expand: opts.expand,
    includeImports: true,
  };
  const fetchIfChanged = (etag: string | null) =>
    api.listSecretsIfChanged(project, ctx.config.env.value, query, etag);
  const first = await withExpandHint(opts.expand, fetchIfChanged(null));
  if (!first.changed)
    throw new CliError(EXIT.ERROR, "Anchor answered 304 to a request without a tag");
  let etag = first.etag;
  let env = buildChildEnv(ctx.deps.io.env, first.secrets, opts.override);
  let count = first.secrets.length;

  const start = () => {
    ctx.out.debug(`injecting ${count} secrets into ${cmd}`);
    const handle = ctx.deps.startChild(cmd, args, env);
    const state: { handle: ChildHandle; exit?: Exit } = { handle };
    // Recorded as soon as it happens, so a poll that finishes later sees the child is gone.
    handle.exited.then(
      (r) => {
        state.exit = r;
      },
      () => {},
    );
    return state;
  };
  let child = start();
  let failing = false;

  for (;;) {
    const exited = await exitedWithin(child.handle.exited, intervalMs, sleep);
    if (exited) return exitCodeFromChild(exited);
    // Someone is stopping anchor and the child is shutting down: wait for it, never restart it.
    if (child.handle.stopRequested()) return exitCodeFromChild(await child.handle.exited);

    let next: Record<string, string> | undefined;
    try {
      const res = await fetchIfChanged(etag);
      if (failing) ctx.out.notice("Reconnected to Anchor");
      failing = false;
      if (res.changed) {
        etag = res.etag;
        const candidate = buildChildEnv(ctx.deps.io.env, res.secrets, opts.override);
        if (!sameEnv(candidate, env)) {
          next = candidate;
          count = res.secrets.length;
        }
      }
    } catch (e) {
      if (!failing) {
        const message = e instanceof Error ? e.message : String(e);
        ctx.out.warn(`Could not check Anchor for changes (${message}); keeping the current values`);
      }
      failing = true;
    }
    if (child.exit) return exitCodeFromChild(child.exit);
    if (child.handle.stopRequested()) return exitCodeFromChild(await child.handle.exited);
    if (!next) continue;

    ctx.out.notice(`Secrets changed; restarting ${cmd}`);
    const stopped = await stop(child.handle, sleep);
    // A stop signal during the grace period ends the watch with that child's code.
    if (child.handle.stopRequested()) return exitCodeFromChild(stopped);
    env = next;
    child = start();
  }
}

/**
 * How the child exited, if it does within `ms`; undefined otherwise. The sleep's timer is
 * cancelled either way, so a finished watch never waits on a leftover timer.
 */
async function exitedWithin(
  exited: Promise<Exit>,
  ms: number,
  sleep: Sleep,
): Promise<Exit | undefined> {
  const timer = new AbortController();
  try {
    return await Promise.race([exited, sleep(ms, timer.signal).then(() => undefined)]);
  } finally {
    timer.abort();
  }
}

/** SIGTERM, then SIGKILL if the child is still alive after RESTART_GRACE_MS. */
async function stop(child: ChildHandle, sleep: Sleep): Promise<Exit> {
  child.kill("SIGTERM");
  const exited = await exitedWithin(child.exited, RESTART_GRACE_MS, sleep);
  if (exited) return exited;
  child.kill("SIGKILL");
  return child.exited;
}
