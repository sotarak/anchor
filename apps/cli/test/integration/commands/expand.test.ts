import type { SecretDto } from "@anchor/shared";
import { describe, expect, it } from "vitest";
import type { RunChild } from "#src/context";
import { apiError, loggedIn } from "#test/support";

const P = ["--project", "app", "--env", "dev"];
const UNRESOLVED = "Unresolved reference ${HOME} in dev:/CMD; escape a literal with $${";
const secret = (key: string, value: string): SecretDto => ({
  key,
  path: "/",
  version: 1,
  comment: "",
  updatedAt: 0,
  value,
});

function fakeRunChild() {
  const calls: { cmd: string; env: Record<string, string> }[] = [];
  const runChild: RunChild = async (cmd, _args, env) => {
    calls.push({ cmd, env });
    return { code: 0, signal: null };
  };
  return { runChild, calls };
}

describe("reference expansion flags", () => {
  it("run sends expand=true by default and expand=false with --no-expand", async () => {
    const cli = await loggedIn();
    const child = fakeRunChild();
    const listSecrets = async () => [secret("A", "x")];
    const on = await cli.run(["run", ...P, "--", "env"], { listSecrets }, child);
    expect(on.fake.called("listSecrets")[0]?.args).toEqual([
      "app",
      "dev",
      { path: "/", reveal: true, expand: true, includeImports: true },
    ]);
    const off = await cli.run(["run", "--no-expand", ...P, "--", "env"], { listSecrets }, child);
    expect(off.fake.called("listSecrets")[0]?.args).toEqual([
      "app",
      "dev",
      { path: "/", reveal: true, expand: false, includeImports: true },
    ]);
  });

  it("run fails closed on 400 unresolved reference: child not spawned, exit 1, hint printed", async () => {
    const cli = await loggedIn();
    const child = fakeRunChild();
    const r = await cli.run(
      ["run", ...P, "--", "env"],
      { listSecrets: async () => Promise.reject(apiError(400, "bad_request", UNRESOLVED)) },
      child,
    );
    expect(r.code).toBe(1);
    expect(child.calls).toEqual([]);
    expect(r.err).toContain(`error: ${UNRESOLVED}`);
    expect(r.err).toContain("hint: Use --no-expand to skip reference expansion.");
  });

  it("run on 403 forbidden reference exits 4 without spawning", async () => {
    const cli = await loggedIn();
    const child = fakeRunChild();
    const r = await cli.run(
      ["run", ...P, "--", "env"],
      {
        listSecrets: async () =>
          Promise.reject(
            apiError(
              403,
              "forbidden",
              "You do not have permission to read the reference ${prod:/X} in dev:/A",
            ),
          ),
      },
      child,
    );
    expect(r.code).toBe(4);
    expect(child.calls).toEqual([]);
    expect(r.err).not.toContain("--no-expand");
  });

  it("export sends the expansion flags and adds the hint on 400", async () => {
    const cli = await loggedIn();
    const ok = await cli.run(["export", "--no-expand", ...P], {
      listSecrets: async () => [secret("A", "${B}")],
    });
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("A=");
    expect(ok.fake.called("listSecrets")[0]?.args).toEqual([
      "app",
      "dev",
      { path: "/", reveal: true, expand: false, includeImports: true },
    ]);
    const bad = await cli.run(["export", ...P], {
      listSecrets: async () => Promise.reject(apiError(400, "bad_request", UNRESOLVED)),
    });
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("hint: Use --no-expand to skip reference expansion.");
  });

  it("secrets get expands by default; --no-expand reads the raw value", async () => {
    const cli = await loggedIn();
    const getSecret = async () => secret("A", "v");
    const on = await cli.run(["secrets", "get", "A", ...P], { getSecret });
    expect(on.fake.called("getSecret")[0]?.args).toEqual([
      "app",
      "dev",
      "A",
      { path: "/", expand: true, includeImports: true },
    ]);
    const off = await cli.run(["secrets", "get", "A", "--no-expand", ...P], { getSecret });
    expect(off.fake.called("getSecret")[0]?.args).toEqual([
      "app",
      "dev",
      "A",
      { path: "/", expand: false, includeImports: true },
    ]);
  });
});
