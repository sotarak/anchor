import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EnvironmentDto, ProjectDto } from "@anchor/shared";
import { describe, expect, it } from "vitest";
import { apiError, loggedIn } from "#test/support";

const app: ProjectDto = { id: "p1", slug: "app", name: "App", createdAt: 0 };
const web: ProjectDto = { id: "p2", slug: "web", name: "Web", createdAt: 0 };
const envs: EnvironmentDto[] = [
  { id: "e1", slug: "dev", name: "Development", position: 0 },
  { id: "e2", slug: "prod", name: "Production", position: 1 },
];
const api = {
  listProjects: async () => [app, web],
  getProject: async (slug: string) => {
    if (slug === "app" || slug === "web") return slug === "app" ? app : web;
    throw apiError(404, "not_found", "Project not found");
  },
  listEnvironments: async () => envs,
};
const fileOf = async (dir: string) =>
  JSON.parse(await readFile(join(dir, ".anchor.json"), "utf8")) as unknown;

describe("anchor init", () => {
  it("init non-interactive with --project and --env writes the documented file", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["init", "--project", "app", "--env", "prod"], api);
    expect(r.code).toBe(0);
    expect(await fileOf(cli.dir)).toEqual({ version: 1, project: "app", defaultEnv: "prod" });
    expect(r.out).toBe(`Linked ${cli.dir} to app (default env prod)\n`);
  });

  it("--json prints the documented shape; apiUrl is written only when it came from a flag", async () => {
    const cli = await loggedIn();
    const r = await cli.run(
      [
        "init",
        "--json",
        "--project",
        "app",
        "--env",
        "dev",
        "--api-url",
        "https://anchor.example/",
      ],
      api,
    );
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual({
      projectFile: join(cli.dir, ".anchor.json"),
      project: "app",
      defaultEnv: "dev",
    });
    expect(await fileOf(cli.dir)).toEqual({
      version: 1,
      project: "app",
      defaultEnv: "dev",
      apiUrl: "https://anchor.example",
    });
  });

  it("defaults the env to dev, else the first env, without prompting in non-TTY", async () => {
    const cli = await loggedIn();
    expect((await cli.run(["init", "--project", "app"], api)).code).toBe(0);
    expect(await fileOf(cli.dir)).toEqual({ version: 1, project: "app", defaultEnv: "dev" });
    const other = await loggedIn();
    const noDev = { ...api, listEnvironments: async () => [envs[1] as EnvironmentDto] };
    expect((await other.run(["init", "--project", "app"], noDev)).code).toBe(0);
    expect(await fileOf(other.dir)).toEqual({ version: 1, project: "app", defaultEnv: "prod" });
  });

  it("init without --project in non-TTY exits 2", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["init"], api);
    expect(r.code).toBe(2);
    expect(r.err).toContain("error: Pass --project in non-interactive mode");
    expect(r.fake.calls).toEqual([]);
  });

  it("init with unknown project exits 5 and writes nothing", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["init", "--project", "nope", "--env", "dev"], api);
    expect(r.code).toBe(5);
    expect(r.err).toContain("error: Project nope not found");
    await expect(readFile(join(cli.dir, ".anchor.json"))).rejects.toThrow();
  });

  it("init refuses to overwrite in non-TTY without --yes; overwrites with --yes", async () => {
    const cli = await loggedIn();
    const original = `${JSON.stringify({ version: 1, project: "web" })}\n`;
    await writeFile(join(cli.dir, ".anchor.json"), original);
    const refused = await cli.run(["init", "--project", "app", "--env", "dev"], api);
    expect(refused.code).toBe(2);
    expect(await readFile(join(cli.dir, ".anchor.json"), "utf8")).toBe(original);
    const forced = await cli.run(["init", "--yes", "--project", "app", "--env", "dev"], api);
    expect(forced.code).toBe(0);
    expect(await fileOf(cli.dir)).toEqual({ version: 1, project: "app", defaultEnv: "dev" });
  });

  it("init interactive selects project and env via prompts", async () => {
    const cli = await loggedIn({ tty: true, prompts: { select: ["web", "prod"] } });
    const r = await cli.run(["init"], api);
    expect(r.code).toBe(0);
    expect(cli.prompts.calls.map((c) => [c.kind, c.choices])).toEqual([
      [
        "select",
        [
          { name: "App (app)", value: "app" },
          { name: "Web (web)", value: "web" },
        ],
      ],
      [
        "select",
        [
          { name: "Development (dev)", value: "dev" },
          { name: "Production (prod)", value: "prod" },
        ],
      ],
    ]);
    expect(await fileOf(cli.dir)).toEqual({ version: 1, project: "web", defaultEnv: "prod" });
  });

  it("interactive overwrite asks for confirmation; declining aborts", async () => {
    const cli = await loggedIn({ tty: true, prompts: { confirm: [false] } });
    await writeFile(join(cli.dir, ".anchor.json"), JSON.stringify({ version: 1, project: "web" }));
    const r = await cli.run(["init", "--project", "app", "--env", "dev"], api);
    expect(r.code).toBe(1);
    expect(cli.prompts.calls.map((c) => c.message)).toEqual(["Overwrite .anchor.json?"]);
    expect(await fileOf(cli.dir)).toEqual({ version: 1, project: "web" });
  });
});
