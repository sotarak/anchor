import type { FolderImportDto } from "@anchor/shared";
import { describe, expect, it } from "vitest";
import { apiError, loggedIn } from "#test/support";

const P = ["--project", "app", "--env", "dev"];
const imp = (id: string, environment: string, path: string, position: number, at = "/") =>
  ({ id, path: at, source: { environment, path }, position }) satisfies FolderImportDto;
const shared = imp("i1", "shared", "/", 1);
const sharedDb = imp("i2", "shared", "/db", 2);

describe("anchor imports list", () => {
  it('prints "<position>  <src>" lines; --json is the DTO array; --path is sent', async () => {
    const cli = await loggedIn();
    const r = await cli.run(["imports", "list", ...P], {
      listImports: async () => [shared, sharedDb],
    });
    expect(r.code).toBe(0);
    expect(r.out).toBe("1  shared:/\n2  shared:/db\n");
    expect(r.fake.called("listImports")[0]?.args).toEqual(["app", "dev", { path: "/" }]);

    const json = await (await loggedIn()).run(
      ["imports", "list", "--path", "/api", "--json", ...P],
      { listImports: async () => [shared] },
    );
    expect(JSON.parse(json.out)).toEqual([shared]);
    expect(json.fake.called("listImports")[0]?.args).toEqual(["app", "dev", { path: "/api" }]);
  });

  it("numbers imports 1..n even when positions have gaps; --json keeps position", async () => {
    const gap = [shared, imp("i3", "shared", "/db", 3)];
    const r = await (await loggedIn()).run(["imports", "list", ...P], { listImports: async () => gap });
    expect(r.out).toBe("1  shared:/\n2  shared:/db\n");
    const json = await (await loggedIn()).run(["imports", "list", "--json", ...P], {
      listImports: async () => gap,
    });
    expect(JSON.parse(json.out)[1].position).toBe(3);
  });

  it('an empty list says "No imports in dev:/" on stderr and nothing on stdout', async () => {
    const cli = await loggedIn();
    const r = await cli.run(["imports", "list", ...P], { listImports: async () => [] });
    expect(r.code).toBe(0);
    expect(r.out).toBe("");
    expect(r.err).toContain("No imports in dev:/");
  });
});

describe("anchor imports add", () => {
  it("sends the normalized source", async () => {
    for (const [raw, path] of [
      ["shared", "/"],
      ["shared:", "/"],
      ["shared:/", "/"],
      ["shared:db/", "/db"],
      ["shared:/db", "/db"],
    ] as const) {
      const cli = await loggedIn();
      const r = await cli.run(["imports", "add", raw, "--path", "/api", ...P], {
        listImports: async () => [],
        createImport: async () => imp("n", "shared", path, 1, "/api"),
      });
      expect(r.code, raw).toBe(0);
      expect(r.fake.called("createImport")[0]?.args).toEqual([
        "app",
        "dev",
        { path: "/api", source: { environment: "shared", path } },
      ]);
      expect(r.out).toBe(`Imported shared:${path} into dev:/api\n`);
    }
  });

  it("an existing import is created:false without a POST", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["imports", "add", "shared:/", ...P], {
      listImports: async () => [shared],
    });
    expect(r.code).toBe(0);
    expect(r.out).toBe("Already imports shared:/ into dev:/\n");
    expect(r.fake.called("createImport")).toEqual([]);

    const json = await (await loggedIn()).run(["imports", "add", "shared", "--json", ...P], {
      listImports: async () => [shared],
    });
    expect(JSON.parse(json.out)).toEqual({ import: shared, created: false });
  });

  it("losing a race (409) re-lists and reports created:false, exit 0", async () => {
    const cli = await loggedIn();
    let lists = 0;
    const r = await cli.run(["imports", "add", "shared:/", "--json", ...P], {
      listImports: async () => (lists++ === 0 ? [] : [shared]),
      createImport: async () =>
        Promise.reject(apiError(409, "conflict", "This import already exists")),
    });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual({ import: shared, created: false });
    expect(r.fake.called("listImports")).toHaveLength(2);
  });

  it("passes API errors through with their exit codes", async () => {
    for (const [error, code] of [
      [apiError(400, "bad_request", "A folder cannot import itself"), 1],
      [apiError(404, "not_found", "Environment not found"), 5],
      [apiError(403, "forbidden", "Forbidden"), 4],
    ] as const) {
      const cli = await loggedIn();
      const r = await cli.run(["imports", "add", "shared:/", ...P], {
        listImports: async () => [],
        createImport: async () => Promise.reject(error),
      });
      expect(r.code).toBe(code);
      expect(r.err).toContain(error.message);
    }
  });

  it("an invalid source is exit 2 with no request", async () => {
    for (const raw of [":/db", "a b:/", "shared:/a b", "shared:../x", "Shared:/"]) {
      const cli = await loggedIn();
      const r = await cli.run(["imports", "add", raw, ...P]);
      expect(r.code, raw).toBe(2);
      expect(r.err).toContain(`Invalid import source '${raw}'`);
      expect(r.err).toContain("Use <env>:<path>, e.g. shared:/ or shared:/db");
      expect(r.fake.calls).toEqual([]);
    }
  });
});

describe("anchor imports remove", () => {
  it("finds the import by normalized source and deletes its id", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["imports", "remove", "shared:db", "--yes", ...P], {
      listImports: async () => [shared, sharedDb],
      deleteImport: async () => undefined,
    });
    expect(r.code).toBe(0);
    expect(r.fake.called("deleteImport")[0]?.args).toEqual(["app", "dev", "i2"]);
    expect(r.out).toBe("Stopped importing shared:/db into dev:/\n");

    const json = await (await loggedIn()).run(
      ["imports", "remove", "shared", "--yes", "--json", ...P],
      { listImports: async () => [shared], deleteImport: async () => undefined },
    );
    expect(JSON.parse(json.out)).toEqual({ removed: shared });
  });

  it("a source that is not imported is exit 5 naming the current imports", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["imports", "remove", "prod:/", "--yes", ...P], {
      listImports: async () => [shared, sharedDb],
    });
    expect(r.code).toBe(5);
    expect(r.err).toContain("dev:/ does not import prod:/");
    expect(r.err).toContain("Its imports: shared:/, shared:/db");
    expect(r.fake.called("deleteImport")).toEqual([]);

    const none = await (await loggedIn()).run(["imports", "remove", "prod", "--yes", ...P], {
      listImports: async () => [],
    });
    expect(none.code).toBe(5);
    expect(none.err).toContain("It has no imports");
  });

  it("non-TTY without --yes is exit 2 with no request", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["imports", "remove", "shared:/", ...P]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("Refusing to continue without --yes");
    expect(r.fake.calls).toEqual([]);
  });

  it("in a terminal it asks first, and declining sends nothing", async () => {
    const cli = await loggedIn({ tty: true, prompts: { confirm: [false] } });
    const r = await cli.run(["imports", "remove", "shared:/", "--path", "/api", ...P], {
      listImports: async () => [imp("i1", "shared", "/", 1, "/api")],
    });
    expect(r.code).toBe(1);
    expect(cli.prompts.calls.map((c) => c.message)).toEqual([
      "Stop importing shared:/ into dev:/api?",
    ]);
    expect(r.fake.called("deleteImport")).toEqual([]);
  });
});
