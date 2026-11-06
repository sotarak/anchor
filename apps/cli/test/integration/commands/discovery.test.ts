import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EnvironmentDto, ProjectDto } from "@anchor/shared";
import { describe, expect, it } from "vitest";
import { apiError, loggedIn } from "#test/support";

const created = Date.UTC(2026, 10, 1, 12, 0, 0);
const projects: ProjectDto[] = [
  { id: "p1", slug: "app", name: "App", createdAt: created },
  { id: "p2", slug: "website", name: "Marketing site", createdAt: created },
];
const environments: EnvironmentDto[] = [
  { id: "e1", slug: "dev", name: "Development", position: 0 },
  { id: "e2", slug: "prod", name: "Production", position: 1 },
];

describe("anchor projects list / envs list", () => {
  it("projects list and envs list human + --json output", async () => {
    const cli = await loggedIn();
    const human = await cli.run(["projects", "list"], { listProjects: async () => projects });
    expect(human.code).toBe(0);
    expect(human.out).toBe(
      [
        "SLUG     NAME            CREATED",
        "app      App             2026-11-01",
        "website  Marketing site  2026-11-01",
        "",
      ].join("\n"),
    );

    const json = await loggedIn();
    const r = await json.run(["projects", "list", "--json"], {
      listProjects: async () => projects,
    });
    expect(JSON.parse(r.out)).toEqual({ projects });

    const envCli = await loggedIn();
    const e = await envCli.run(["envs", "list", "--project", "app"], {
      listEnvironments: async () => environments,
    });
    expect(e.code).toBe(0);
    expect(e.out).toBe("SLUG  NAME\ndev   Development\nprod  Production\n");
    expect(e.fake.called("listEnvironments")[0]?.args).toEqual(["app"]);

    const envJson = await loggedIn();
    const ej = await envJson.run(["--json", "envs", "list", "--project", "app"], {
      listEnvironments: async () => environments,
    });
    expect(JSON.parse(ej.out)).toEqual({ environments });
  });

  it("envs list uses the project from .anchor.json", async () => {
    const cli = await loggedIn();
    await writeFile(join(cli.dir, ".anchor.json"), JSON.stringify({ version: 1, project: "app" }));
    const r = await cli.run(["envs", "list"], { listEnvironments: async () => environments });
    expect(r.code).toBe(0);
    expect(r.fake.called("listEnvironments")[0]?.args).toEqual(["app"]);
  });

  it("an empty project list prints a hint, not an empty table", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["projects", "list"], { listProjects: async () => [] });
    expect(r.code).toBe(0);
    expect(r.out).toBe("");
    expect(r.err).toContain("No projects");
  });

  it("envs list without a project exits 2 with the init hint", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["envs", "list"], {});
    expect(r.code).toBe(2);
    expect(r.err).toBe(
      "error: No project selected\nhint: Run 'anchor init' or pass --project <slug>\n",
    );
  });

  it("403 from the API maps to exit 4", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["envs", "list", "--project", "app"], {
      listEnvironments: async () => Promise.reject(apiError(403, "forbidden", "Forbidden")),
    });
    expect(r.code).toBe(4);
    expect(r.err).toContain("error: Forbidden");
  });
});
