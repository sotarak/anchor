import type { SecretDto } from "@anchor/shared";
import { describe, expect, it } from "vitest";
import { buildChildEnv } from "#src/commands/run";
import type { RunChild } from "#src/context";
import { apiError, loggedIn } from "#test/support";

const CANARY = "RUN-CANARY-91c";
const secret = (key: string, value: string): SecretDto => ({
  key,
  path: "/",
  version: 1,
  comment: "",
  updatedAt: 0,
  value,
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
