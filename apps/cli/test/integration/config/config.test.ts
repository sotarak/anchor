import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findProjectFile,
  PROJECT_FILE,
  readProjectFile,
  writeProjectFile,
} from "#src/config/project-file";
import { resolveConfig } from "#src/config/resolve";
import { readUserConfig, userConfigDir, writeUserConfig } from "#src/config/user-config";
import type { GlobalFlags } from "#src/context";
import { CliError, EXIT } from "#src/errors";
import { createTestIo, tmpDir } from "#test/support";

const noFlags: GlobalFlags = { json: false, quiet: false, color: true, debug: false, yes: false };

async function setup(layers: {
  flags?: Partial<GlobalFlags>;
  env?: Record<string, string>;
  project?: Record<string, unknown>;
  user?: Record<string, unknown>;
}) {
  const root = await tmpDir();
  const cwd = join(root, "repo", "sub");
  await mkdir(cwd, { recursive: true });
  const xdg = join(root, "xdg");
  if (layers.project) {
    await writeFile(join(root, "repo", PROJECT_FILE), JSON.stringify(layers.project));
  }
  if (layers.user) {
    await mkdir(join(xdg, "anchor"), { recursive: true });
    await writeFile(join(xdg, "anchor", "config.json"), JSON.stringify(layers.user));
  }
  const io = createTestIo({ cwd, env: { XDG_CONFIG_HOME: xdg, ...layers.env }, homeDir: root });
  return { io, root, cwd, config: () => resolveConfig(io, { ...noFlags, ...layers.flags }) };
}

async function rejected(p: Promise<unknown>): Promise<CliError> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(CliError);
  return e as CliError;
}

describe("resolveConfig", () => {
  it("flag beats env beats project file beats user config beats default", async () => {
    const flags = {
      apiUrl: "https://flag.example",
      project: "flag-proj",
      env: "flag-env",
      path: "/flag",
    };
    const env = {
      ANCHOR_API_URL: "https://env.example",
      ANCHOR_PROJECT: "env-proj",
      ANCHOR_ENV: "env-env",
      ANCHOR_PATH: "/env",
    };
    const project = {
      version: 1,
      apiUrl: "https://project.example",
      project: "file-proj",
      defaultEnv: "file-env",
      path: "/file",
    };
    const user = { apiUrl: "https://user.example" };

    const all = await (await setup({ flags, env, project, user })).config();
    expect(all.apiUrl).toEqual({ value: "https://flag.example", source: "flag" });
    expect(all.project).toEqual({ value: "flag-proj", source: "flag" });
    expect(all.env).toEqual({ value: "flag-env", source: "flag" });
    expect(all.path).toEqual({ value: "/flag", source: "flag" });

    const noFlag = await (await setup({ env, project, user })).config();
    expect(noFlag.apiUrl).toEqual({ value: "https://env.example", source: "env" });
    expect(noFlag.project).toEqual({ value: "env-proj", source: "env" });
    expect(noFlag.env).toEqual({ value: "env-env", source: "env" });
    expect(noFlag.path).toEqual({ value: "/env", source: "env" });

    const fileOnly = await (await setup({ project, user })).config();
    expect(fileOnly.apiUrl).toEqual({ value: "https://project.example", source: "project" });
    expect(fileOnly.project).toEqual({ value: "file-proj", source: "project" });
    expect(fileOnly.env).toEqual({ value: "file-env", source: "project" });
    expect(fileOnly.path).toEqual({ value: "/file", source: "project" });
    expect(fileOnly.userApiUrl).toBe("https://user.example");

    const userOnly = await (await setup({ user })).config();
    expect(userOnly.apiUrl).toEqual({ value: "https://user.example", source: "user" });
    expect(userOnly.project).toBeNull();
    expect(userOnly.projectFilePath).toBeNull();

    const none = await (await setup({})).config();
    expect(none.apiUrl).toBeNull();
    expect(none.userApiUrl).toBeNull();
  });

  it("env defaults to dev and path to /", async () => {
    const c = await (await setup({})).config();
    expect(c.env).toEqual({ value: "dev", source: "default" });
    expect(c.path).toEqual({ value: "/", source: "default" });
  });

  it("normalizes apiUrl and path from any source", async () => {
    const c = await (
      await setup({ flags: { path: "api/" }, env: { ANCHOR_API_URL: "https://a.example/x/" } })
    ).config();
    expect(c.apiUrl?.value).toBe("https://a.example");
    expect(c.path.value).toBe("/api");
    const bad = await rejected((await setup({ flags: { path: "../x" } })).config());
    expect(bad.exitCode).toBe(EXIT.USAGE);
    expect(bad.message).toBe("Invalid path: ../x");
  });

  it("finds .anchor.json in a parent directory", async () => {
    const s = await setup({ project: { version: 1, project: "app" } });
    expect(await findProjectFile(s.cwd)).toBe(join(s.root, "repo", PROJECT_FILE));
    expect((await s.config()).projectFilePath).toBe(join(s.root, "repo", PROJECT_FILE));
    expect(await findProjectFile(await tmpDir())).toBeNull();
  });

  it("project file with unknown key is rejected naming the key", async () => {
    const s = await setup({ project: { version: 1, project: "app", tokenFile: "x" } });
    const e = await rejected(s.config());
    expect(e.exitCode).toBe(EXIT.ERROR);
    expect(e.message).toBe(`${join(s.root, "repo", PROJECT_FILE)} is invalid: tokenFile`);
  });

  it("project file with a bad field or bad JSON is rejected", async () => {
    const s = await setup({ project: { version: 2, project: "App!" } });
    expect((await rejected(s.config())).message).toMatch(/is invalid: version, project$/);
    const dir = await tmpDir();
    await writeFile(join(dir, PROJECT_FILE), "{ nope");
    expect((await rejected(readProjectFile(join(dir, PROJECT_FILE)))).message).toBe(
      `${join(dir, PROJECT_FILE)} is invalid: not valid JSON`,
    );
  });

  it("project file containing an anc_ token is rejected and the message does not contain the token", async () => {
    const token = "anc_st_SECRETCANARY";
    for (const project of [
      { version: 1, project: "app", apiUrl: token },
      { version: 1, project: "app", extra: { nested: [token] } },
    ]) {
      const s = await setup({ project });
      const e = await rejected(s.config());
      expect(e.exitCode).toBe(EXIT.ERROR);
      expect(e.message).toBe(
        `${join(s.root, "repo", PROJECT_FILE)} contains a token. Tokens must never be stored in .anchor.json`,
      );
      expect(e.hint).toBe("Remove it and rotate the token");
      expect(`${e.message} ${e.hint}`).not.toContain("SECRETCANARY");
    }
  });

  it("writeProjectFile writes 2-space JSON with a newline and mode 0644", async () => {
    const dir = await tmpDir();
    const path = await writeProjectFile(dir, { version: 1, project: "app", defaultEnv: "dev" });
    expect(path).toBe(join(dir, PROJECT_FILE));
    expect(await readFile(path, "utf8")).toBe(
      `${JSON.stringify({ version: 1, project: "app", defaultEnv: "dev" }, null, 2)}\n`,
    );
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o644);
    expect(await readProjectFile(path)).toEqual({ version: 1, project: "app", defaultEnv: "dev" });
  });
});

describe("user config", () => {
  it("userConfigDir follows XDG_CONFIG_HOME, then ~/.config, then %APPDATA% on Windows", () => {
    expect(userConfigDir(createTestIo({ env: { XDG_CONFIG_HOME: "/x" }, homeDir: "/h" }))).toBe(
      "/x/anchor",
    );
    expect(userConfigDir(createTestIo({ homeDir: "/h", platform: "linux" }))).toBe(
      "/h/.config/anchor",
    );
    expect(
      userConfigDir(
        createTestIo({ platform: "win32", env: { APPDATA: "C:\\Users\\a\\AppData\\Roaming" } }),
      ),
    ).toBe("C:\\Users\\a\\AppData\\Roaming\\anchor");
  });

  it("missing user config reads as {}", async () => {
    const io = createTestIo({ env: { XDG_CONFIG_HOME: await tmpDir() } });
    expect(await readUserConfig(io)).toEqual({});
  });

  it.skipIf(process.platform === "win32")(
    "user config is written with mode 0600 in XDG_CONFIG_HOME/anchor",
    async () => {
      const xdg = await tmpDir();
      const io = createTestIo({ env: { XDG_CONFIG_HOME: xdg } });
      await writeUserConfig(io, { apiUrl: "https://a.example" });
      const file = join(xdg, "anchor", "config.json");
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect((await stat(join(xdg, "anchor"))).mode & 0o777).toBe(0o700);
      expect(await readUserConfig(io)).toEqual({ apiUrl: "https://a.example" });
    },
  );
});

describe("requireProject", () => {
  it("returns the resolved project or exits 2 with the init hint", async () => {
    const { requireProject } = await import("#src/context");
    const withProject = await (await setup({ flags: { project: "app" } })).config();
    expect(requireProject({ config: withProject } as never)).toBe("app");
    const without = await (await setup({})).config();
    let err: unknown;
    try {
      requireProject({ config: without } as never);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect([(err as CliError).exitCode, (err as CliError).message, (err as CliError).hint]).toEqual(
      [EXIT.USAGE, "No project selected", "Run 'anchor init' or pass --project <slug>"],
    );
  });
});
