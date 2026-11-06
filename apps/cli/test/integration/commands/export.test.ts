import { execFileSync } from "node:child_process";
import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SecretDto } from "@anchor/shared";
import { parse as parseDotenv } from "dotenv";
import { describe, expect, it } from "vitest";
import { createNodeSpawner } from "#src/process/spawner";
import { loggedIn } from "#test/support";

const secret = (key: string, value: string): SecretDto => ({
  key,
  path: "/",
  version: 1,
  comment: "",
  updatedAt: 0,
  value,
});
const secrets = [secret("B_KEY", "two words"), secret("A_KEY", "postgres://u:p@h/db")];
const api = { listSecrets: async () => secrets };
const P = ["--project", "app", "--env", "dev"];
const posix = process.platform !== "win32";

async function repo(opts: Parameters<typeof loggedIn>[0] = {}) {
  const cli = await loggedIn(opts);
  execFileSync("git", ["init", "-q", cli.dir]);
  await writeFile(join(cli.dir, ".gitignore"), ".env.local\n.xdg/\n");
  return cli;
}
const spawner = createNodeSpawner();

describe("anchor export", () => {
  it("refuses TTY stdout without --output", async () => {
    const cli = await loggedIn({ stdoutTTY: true });
    const r = await cli.run(["export", ...P], api);
    expect(r.code).toBe(2);
    expect(r.err).toContain("error: Refusing to print secrets to a terminal");
    expect(r.err).toContain("hint: Use --output <file> or pipe the output");
    expect(r.out).toBe("");
  });

  it("pipes dotenv to non-TTY stdout", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["export", ...P], api);
    expect(r.code).toBe(0);
    expect(r.out).toBe("A_KEY=postgres://u:p@h/db\nB_KEY='two words'\n");
    expect(r.fake.called("listSecrets")[0]?.args).toEqual([
      "app",
      "dev",
      { path: "/", reveal: true, expand: true, includeImports: true },
    ]);
  });

  it("pipes json and yaml formats; --json without --output is a usage error", async () => {
    const json = await loggedIn();
    const j = await json.run(["export", "--format", "json", ...P], api);
    expect(JSON.parse(j.out)).toEqual({ A_KEY: "postgres://u:p@h/db", B_KEY: "two words" });
    const yaml = await loggedIn();
    expect((await yaml.run(["export", "--format", "yaml", ...P], api)).out).toBe(
      '"A_KEY": "postgres://u:p@h/db"\n"B_KEY": "two words"\n',
    );
    const misuse = await loggedIn();
    const m = await misuse.run(["export", "--json", ...P], api);
    expect(m.code).toBe(2);
    expect(m.err).toContain("error: Use --format json instead of --json");
    const bad = await loggedIn();
    expect((await bad.run(["export", "--format", "toml", ...P], api)).code).toBe(2);
  });

  it("an unrepresentable dotenv value fails before anything is written", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["export", "--output", ".env.local", ...P], {
      listSecrets: async () => [secret("CERT", 'a "b"\nc')],
    });
    expect(r.code).toBe(1);
    expect(r.err).toContain("Value of CERT cannot be represented in dotenv format");
    await expect(stat(join(cli.dir, ".env.local"))).rejects.toThrow();
  });

  it.skipIf(!posix)("--output creates the file with mode 0600", async () => {
    const cli = await repo();
    const r = await cli.run(["export", "--output", ".env.local", ...P], api, { spawner });
    expect(r.code).toBe(0);
    const file = join(cli.dir, ".env.local");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(parseDotenv(await readFile(file, "utf8"))).toEqual({
      A_KEY: "postgres://u:p@h/db",
      B_KEY: "two words",
    });
    expect(r.out).toBe("Wrote 2 secrets to .env.local\n");
    const json = await repo();
    const j = await json.run(
      ["export", "--json", "--format", "yaml", "--output", ".env.local", ...P],
      api,
      {
        spawner,
      },
    );
    expect(JSON.parse(j.out)).toEqual({
      path: join(json.dir, ".env.local"),
      count: 2,
      format: "yaml",
    });
  });

  it.skipIf(!posix)(
    "--output over an existing 0644 file leaves it 0600 after confirmation with --yes",
    async () => {
      const cli = await repo();
      const file = join(cli.dir, ".env.local");
      await writeFile(file, "OLD=1\n");
      await chmod(file, 0o644);
      const r = await cli.run(["export", "--yes", "--output", ".env.local", ...P], api, {
        spawner,
      });
      expect(r.code).toBe(0);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect(await readFile(file, "utf8")).not.toContain("OLD=1");
    },
  );

  it("a TTY overwrite asks for confirmation", async () => {
    const cli = await repo({ tty: true, prompts: { confirm: [true] } });
    await writeFile(join(cli.dir, ".env.local"), "OLD=1\n");
    const r = await cli.run(["export", "--output", ".env.local", ...P], api, { spawner });
    expect(r.code).toBe(0);
    expect(cli.prompts.calls.map((c) => c.message)).toEqual(["Overwrite .env.local?"]);
  });

  it("non-TTY overwrite without --yes exits 2 and leaves the file untouched", async () => {
    const cli = await repo();
    const file = join(cli.dir, ".env.local");
    await writeFile(file, "OLD=1\n");
    const r = await cli.run(["export", "--output", ".env.local", ...P], api, { spawner });
    expect(r.code).toBe(2);
    expect(await readFile(file, "utf8")).toBe("OLD=1\n");
  });

  it("warns when the output file is not gitignored and not when it is", async () => {
    const cli = await repo();
    const ignored = await cli.run(["export", "--output", ".env.local", ...P], api, { spawner });
    expect(ignored.err).not.toContain("gitignore");
    const exposed = await repo();
    const r = await exposed.run(["export", "--output", "secrets.env", ...P], api, { spawner });
    expect(r.code).toBe(0);
    expect(r.err).toContain("warning: secrets.env is not gitignored; add it to .gitignore");
  });

  it("no warning outside a git repo", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["export", "--output", "secrets.env", ...P], api, { spawner });
    expect(r.code).toBe(0);
    expect(r.err).not.toContain("gitignore");
  });
});
