import { EventEmitter } from "node:events";
import type { SecretDto } from "@anchor/shared";
import { describe, expect, it } from "vitest";
import type { ApiClient, ConditionalSecrets } from "#src/api/client";
import { buildChildEnv } from "#src/commands/run";
import type { ChildHandle, RunChild, StartChild } from "#src/context";
import { createNodeStartChild } from "#src/process/run-child";
import { apiError, loggedIn } from "#test/support";

const CANARY = "RUN-CANARY-91c";
const secret = (key: string, value: string, extra: Partial<SecretDto> = {}): SecretDto => ({
  key,
  path: "/",
  version: 1,
  comment: "",
  updatedAt: 0,
  type: "string",
  sensitive: true,
  value,
  ...extra,
});
const P = ["--project", "app", "--env", "dev"];

function fakeRunChild(result: Awaited<ReturnType<RunChild>> = { code: 0, signal: null }) {
  const calls: { cmd: string; args: string[]; env: Record<string, string> }[] = [];
  const runChild: RunChild = async (cmd, args, env) => {
    calls.push({ cmd, args, env });
    return result;
  };
  return { runChild, calls };
}

describe("buildChildEnv", () => {
  it("override true replaces FOO; --no-override keeps the parent FOO; new keys are always added", () => {
    const parent = { FOO: "parent", PATH: "/bin", GONE: undefined };
    const secrets = [secret("FOO", "anchor"), secret("NEW", "x")];
    expect(buildChildEnv(parent, secrets, true)).toEqual({ FOO: "anchor", PATH: "/bin", NEW: "x" });
    expect(buildChildEnv(parent, secrets, false)).toEqual({
      FOO: "parent",
      PATH: "/bin",
      NEW: "x",
    });
  });
});

describe("anchor run", () => {
  it("injects secrets, spawns the command and exits with its code", async () => {
    const cli = await loggedIn({ env: { FOO: "parent" } });
    const child = fakeRunChild({ code: 7, signal: null });
    const r = await cli.run(
      ["run", ...P, "--", "node", "app.js"],
      { listSecrets: async () => [secret("DB_URL", CANARY), secret("FOO", "anchor")] },
      { runChild: child.runChild },
    );
    expect(r.code).toBe(7);
    expect(r.fake.called("listSecrets")[0]?.args).toEqual([
      "app",
      "dev",
      { path: "/", reveal: true, expand: true, includeImports: true },
    ]);
    expect(child.calls[0]?.cmd).toBe("node");
    expect(child.calls[0]?.args).toEqual(["app.js"]);
    expect(child.calls[0]?.env).toMatchObject({ DB_URL: CANARY, FOO: "anchor" });
  });

  it("run injects canonical strings", async () => {
    const cli = await loggedIn();
    const child = fakeRunChild();
    const r = await cli.run(
      ["run", ...P, "--", "env"],
      {
        listSecrets: async () => [
          secret("MODELS", '["a","b"]', { type: "list" }),
          secret("PORT", "8080", { type: "number", sensitive: false }),
        ],
      },
      { runChild: child.runChild },
    );
    expect(r.code).toBe(0);
    expect(child.calls[0]?.env).toMatchObject({ MODELS: '["a","b"]', PORT: "8080" });
  });

  it("--no-override keeps existing variables", async () => {
    const cli = await loggedIn({ env: { FOO: "parent" } });
    const child = fakeRunChild();
    await cli.run(
      ["run", "--no-override", ...P, "--", "env"],
      { listSecrets: async () => [secret("FOO", "anchor")] },
      { runChild: child.runChild },
    );
    expect(child.calls[0]?.env.FOO).toBe("parent");
  });

  it("fetch failure never spawns", async () => {
    const cases = [
      [apiError(0, "network_error", "Could not connect to https://anchor.example"), 1],
      [apiError(401, "unauthenticated", "Unauthenticated"), 3],
      [apiError(403, "forbidden", "Forbidden"), 4],
    ] as const;
    for (const [error, code] of cases) {
      const cli = await loggedIn();
      const child = fakeRunChild();
      const r = await cli.run(
        ["run", ...P, "--", "node", "app.js"],
        { listSecrets: async () => Promise.reject(error) },
        { runChild: child.runChild },
      );
      expect(r.code).toBe(code);
      expect(child.calls).toEqual([]);
    }
  });

  it("missing command after -- exits 2", async () => {
    for (const args of [
      ["run", ...P, "--"],
      ["run", ...P],
    ]) {
      const cli = await loggedIn();
      const child = fakeRunChild();
      const r = await cli.run(args, { listSecrets: async () => [] }, { runChild: child.runChild });
      expect(r.code).toBe(2);
      expect(r.err).toContain("error: Missing command");
      expect(r.err).toContain("hint: Usage: anchor run [options] -- <command> [args...]");
      expect(child.calls).toEqual([]);
      expect(r.fake.calls).toEqual([]);
    }
  });

  it("a command without -- exits 2 before any fetch, so its flags are never taken as Anchor's", async () => {
    for (const args of [
      ["run", "--project", "app", "node", "app.js", "--env", "prod"],
      ["--env", "dev", "run", "node", "app.js"],
      ["run", "--project", "app", "node", "--", "x"],
    ]) {
      const cli = await loggedIn();
      const child = fakeRunChild();
      const r = await cli.run(args, { listSecrets: async () => [] }, { runChild: child.runChild });
      expect(r.code).toBe(2);
      expect(r.err).toContain("error: Put the command after --");
      expect(r.err).toContain("hint: Usage: anchor run [options] -- <command> [args...]");
      expect(child.calls).toEqual([]);
      expect(r.fake.calls).toEqual([]);
    }
  });

  it("flags after -- are passed to the child verbatim", async () => {
    const cli = await loggedIn();
    const child = fakeRunChild();
    const r = await cli.run(
      ["run", ...P, "--", "node", "--version", "--json", "-y", "--env", "x", "--", "z"],
      { listSecrets: async () => [] },
      { runChild: child.runChild },
    );
    expect(r.code).toBe(0);
    expect(child.calls[0]?.cmd).toBe("node");
    expect(child.calls[0]?.args).toEqual(["--version", "--json", "-y", "--env", "x", "--", "z"]);
    expect(r.out).toBe("");
  });

  it("secret values are not printed on stdout/stderr even with --debug", async () => {
    const cli = await loggedIn();
    const child = fakeRunChild();
    const r = await cli.run(
      ["--debug", "run", ...P, "--", "node", "app.js"],
      { listSecrets: async () => [secret("DB_URL", CANARY), secret("B", "x")] },
      { runChild: child.runChild },
    );
    expect(r.code).toBe(0);
    expect(r.err).toContain("debug: injecting 2 secrets into node");
    expect(r.out + r.err).not.toContain(CANARY);
  });

  it("a missing command exits 127", async () => {
    const cli = await loggedIn();
    const r = await cli.run(
      ["run", ...P, "--", "anchor-no-such-command-xyz"],
      { listSecrets: async () => [] },
      { runChild: (await import("#src/process/run-child")).createNodeRunChild() },
    );
    expect(r.code).toBe(127);
    expect(r.err).toContain("error: Command not found: anchor-no-such-command-xyz");
  });
});

type FakeChild = {
  n: number;
  env: Record<string, string>;
  kills: NodeJS.Signals[];
  done: boolean;
  exit(code: number | null, signal?: NodeJS.Signals | null): void;
};

/**
 * Children that exit on exit() or kill() (SIGTERM is ignored for indexes in `ignoresTerm`), and
 * a sleep that records its duration, runs `onSleep`, and resolves on the next macrotask, so a
 * child exiting inside `onSleep` wins the race. `log` keeps the order of starts, kills and sleeps.
 */
function watchRig(
  opts: { ignoresTerm?: number[]; onSleep?: (ms: number, n: number) => void } = {},
) {
  const log: string[] = [];
  const children: FakeChild[] = [];
  let overlaps = 0;
  let sleeps = 0;
  /** Children (by index) that saw a SIGINT, SIGTERM or SIGHUP sent to anchor. */
  const stopRequested = new Set<number>();
  const startChild: StartChild = (_cmd, _args, env) => {
    if (children.some((c) => !c.done)) overlaps++;
    let resolve!: (r: { code: number | null; signal: NodeJS.Signals | null }) => void;
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (r) => (resolve = r),
    );
    const child: FakeChild = {
      n: children.length + 1,
      env,
      kills: [],
      done: false,
      exit(code, signal = null) {
        if (child.done) return;
        child.done = true;
        log.push(`exit ${child.n}`);
        resolve({ code, signal });
      },
    };
    children.push(child);
    log.push(`start ${child.n}`);
    const handle: ChildHandle = {
      exited,
      stopRequested: () => stopRequested.has(child.n),
      kill(signal) {
        child.kills.push(signal);
        log.push(`kill ${child.n} ${signal}`);
        if (signal === "SIGTERM" && opts.ignoresTerm?.includes(child.n - 1)) return;
        child.exit(null, signal);
      },
    };
    return handle;
  };
  const sleep = (ms: number) => {
    sleeps++;
    log.push(`sleep ${ms}`);
    opts.onSleep?.(ms, sleeps);
    return new Promise<void>((r) => setImmediate(r));
  };
  /** A SIGTERM sent to anchor: forwarded to the running child, which may ignore it. */
  const signalAnchor = () => {
    const child = children.at(-1);
    if (!child || child.done) return;
    stopRequested.add(child.n);
    log.push(`signal ${child.n}`);
    if (!opts.ignoresTerm?.includes(child.n - 1)) child.exit(null, "SIGTERM");
  };
  return { startChild, sleep, children, log, overlaps: () => overlaps, signalAnchor };
}

/**
 * Scripted `listSecretsIfChanged`: the first call is the initial fetch; each later call takes
 * the next step. When the steps run out, the current child exits 0, which ends the watch.
 */
function polls(
  rig: ReturnType<typeof watchRig>,
  first: ConditionalSecrets,
  steps: Array<ConditionalSecrets | Error>,
) {
  const tags: Array<string | null> = [];
  const listSecretsIfChanged: ApiClient["listSecretsIfChanged"] = async (_p, _e, _q, etag) => {
    tags.push(etag);
    if (tags.length === 1) return first;
    const step = steps.shift();
    if (!step) {
      rig.children.at(-1)?.exit(0);
      return { changed: false };
    }
    if (step instanceof Error) throw step;
    return step;
  };
  return { listSecretsIfChanged, tags };
}

const changed = (value: string, etag = `"${value}"`): ConditionalSecrets => ({
  changed: true,
  secrets: [secret("A", value)],
  etag,
});
const W = ["run", "--watch", ...P, "--", "node", "app.js"];

describe("anchor run --watch", () => {
  it("restarts with the new environment when a poll returns different secrets", async () => {
    const cli = await loggedIn();
    const rig = watchRig();
    const api = polls(rig, changed("1"), [changed("2")]);
    const r = await cli.run(W, api, { startChild: rig.startChild, sleep: rig.sleep });
    expect(r.code).toBe(0);
    expect(rig.children.map((c) => c.env.A)).toEqual(["1", "2"]);
    expect(rig.children[0]?.kills).toEqual(["SIGTERM"]);
    expect(r.err).toContain("Secrets changed; restarting node");
    expect(r.err).not.toContain("2");
    expect(r.err).not.toContain("A=");
    expect(rig.log.filter((l) => l.startsWith("sleep"))[0]).toBe("sleep 30000");
    expect(rig.overlaps()).toBe(0);
  });

  it("a 304 keeps the child", async () => {
    const cli = await loggedIn();
    const rig = watchRig();
    const api = polls(rig, changed("1", '"t1"'), [{ changed: false }]);
    const r = await cli.run(W, api, { startChild: rig.startChild, sleep: rig.sleep });
    expect(r.code).toBe(0);
    expect(rig.children).toHaveLength(1);
    expect(rig.children[0]?.kills).toEqual([]);
    expect(api.tags).toEqual([null, '"t1"', '"t1"']);
  });

  it("a 200 with an equal environment does not restart and updates the tag", async () => {
    const cli = await loggedIn();
    const rig = watchRig();
    const api = polls(rig, changed("1", '"t1"'), [changed("1", '"t2"')]);
    const r = await cli.run(W, api, { startChild: rig.startChild, sleep: rig.sleep });
    expect(r.code).toBe(0);
    expect(rig.children).toHaveLength(1);
    expect(api.tags).toEqual([null, '"t1"', '"t2"']);
  });

  it("a child that ignores SIGTERM gets SIGKILL after 10 s, and only then does the next one start", async () => {
    const cli = await loggedIn();
    const rig = watchRig({ ignoresTerm: [0] });
    const api = polls(rig, changed("1"), [changed("2")]);
    const r = await cli.run(W, api, { startChild: rig.startChild, sleep: rig.sleep });
    expect(r.code).toBe(0);
    const i = rig.log.indexOf("kill 1 SIGTERM");
    expect(rig.log.slice(i, i + 5)).toEqual([
      "kill 1 SIGTERM",
      "sleep 10000",
      "kill 1 SIGKILL",
      "exit 1",
      "start 2",
    ]);
    expect(rig.overlaps()).toBe(0);
  });

  it("a failed poll keeps the child and warns once; recovery says so", async () => {
    const cli = await loggedIn();
    const rig = watchRig();
    const down = apiError(0, "network_error", "Could not connect to https://anchor.example");
    const api = polls(rig, changed("1"), [down, down, { changed: false }]);
    const r = await cli.run(W, api, { startChild: rig.startChild, sleep: rig.sleep });
    expect(r.code).toBe(0);
    const line =
      "Could not check Anchor for changes (Could not connect to https://anchor.example); keeping the current values";
    expect(r.err.split(line)).toHaveLength(2);
    expect(r.err.indexOf("Reconnected to Anchor")).toBeGreaterThan(r.err.indexOf(line));
    expect(rig.children[0]?.kills).toEqual([]);
  });

  it("the child exiting on its own ends the watch with its code", async () => {
    const cli = await loggedIn();
    const rig = watchRig({ onSleep: (_ms, n) => n === 1 && rig.children[0]?.exit(3) });
    const api = polls(rig, changed("1"), [changed("2")]);
    const r = await cli.run(W, api, { startChild: rig.startChild, sleep: rig.sleep });
    expect(r.code).toBe(3);
    expect(api.tags).toEqual([null]);
    expect(rig.children).toHaveLength(1);
  });

  it("a child that exits during the restart grace is not killed again and the next one starts", async () => {
    const cli = await loggedIn();
    const rig = watchRig({
      ignoresTerm: [0],
      onSleep: (ms) => ms === 10_000 && rig.children[0]?.exit(0),
    });
    const api = polls(rig, changed("1"), [changed("2")]);
    const r = await cli.run(W, api, { startChild: rig.startChild, sleep: rig.sleep });
    expect(r.code).toBe(0);
    expect(rig.children[0]?.kills).toEqual(["SIGTERM"]);
    expect(rig.children.map((c) => c.env.A)).toEqual(["1", "2"]);
    expect(rig.overlaps()).toBe(0);
  });

  it("the first fetch is still fail-closed", async () => {
    const cli = await loggedIn();
    const rig = watchRig();
    const r = await cli.run(
      W,
      { listSecretsIfChanged: async () => Promise.reject(apiError(403, "forbidden", "Forbidden")) },
      { startChild: rig.startChild, sleep: rig.sleep },
    );
    expect(r.code).toBe(4);
    expect(rig.children).toEqual([]);
  });

  it("--watch-interval sets the poll interval", async () => {
    const cli = await loggedIn();
    const rig = watchRig();
    const api = polls(rig, changed("1"), []);
    const args = ["run", "--watch", "--watch-interval", "5", ...P, "--", "node"];
    expect((await cli.run(args, api, { startChild: rig.startChild, sleep: rig.sleep })).code).toBe(
      0,
    );
    expect(rig.log).toContain("sleep 5000");
  });

  it("--watch-interval below 5, non-integer, or without --watch exits 2", async () => {
    for (const extra of [
      ["--watch", "--watch-interval", "4"],
      ["--watch", "--watch-interval", "abc"],
      ["--watch", "--watch-interval", "5.5"],
      ["--watch-interval", "10"],
    ]) {
      const cli = await loggedIn();
      const rig = watchRig();
      const r = await cli.run(
        ["run", ...extra, ...P, "--", "node"],
        {},
        {
          startChild: rig.startChild,
          sleep: rig.sleep,
        },
      );
      expect(r.code, extra.join(" ")).toBe(2);
      expect(r.fake.calls).toEqual([]);
      expect(rig.children).toEqual([]);
    }
  });

  it.skipIf(process.platform === "win32")(
    "a real child that exits leaves no watch timer behind, so anchor exits at once",
    async () => {
      const cli = await loggedIn();
      const timers = () => process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
      const before = timers();
      const r = await cli.run(
        [
          "run",
          "--watch",
          "--watch-interval",
          "3600",
          ...P,
          "--",
          process.execPath,
          "-e",
          "process.exit(3)",
        ],
        { listSecretsIfChanged: async () => changed("1") },
        { startChild: createNodeStartChild(new EventEmitter()) },
      );
      expect(r.code).toBe(3);
      expect(timers()).toBe(before);
    },
  );

  it("a stop signal during the restart grace ends the watch instead of starting the next child", async () => {
    const cli = await loggedIn();
    const rig = watchRig({
      ignoresTerm: [0],
      onSleep: (ms) => {
        if (ms !== 10_000) return;
        rig.signalAnchor();
        rig.children[0]?.exit(0);
      },
    });
    const api = polls(rig, changed("1"), [changed("2")]);
    const r = await cli.run(W, api, { startChild: rig.startChild, sleep: rig.sleep });
    expect(r.code).toBe(0);
    expect(rig.children).toHaveLength(1);
  });

  it("after a stop signal, a changed poll does not restart the shutting-down child", async () => {
    const cli = await loggedIn();
    const rig = watchRig({
      ignoresTerm: [0],
      onSleep: (_ms, n) => {
        if (n !== 1) return;
        rig.signalAnchor();
        setTimeout(() => rig.children[0]?.exit(5), 5);
      },
    });
    const api = polls(rig, changed("1"), [changed("2")]);
    const r = await cli.run(W, api, { startChild: rig.startChild, sleep: rig.sleep });
    expect(r.code).toBe(5);
    expect(rig.children).toHaveLength(1);
    expect(rig.children[0]?.kills).toEqual([]);
  });
});
