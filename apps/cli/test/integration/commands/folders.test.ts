import type { FolderDto } from "@anchor/shared";
import { describe, expect, it } from "vitest";
import { apiError, loggedIn } from "#test/support";

const P = ["--project", "app", "--env", "dev"];
const folders: FolderDto[] = [
  { path: "/api", name: "api" },
  { path: "/web", name: "web" },
];

describe("anchor folders list", () => {
  it("list prints names; --json valid", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["folders", "list", ...P], { listFolders: async () => folders });
    expect(r.code).toBe(0);
    expect(r.out).toBe("api\nweb\n");
    expect(r.fake.called("listFolders")[0]?.args).toEqual(["app", "dev", { path: "/" }]);

    const fresh = await loggedIn();
    const nested = await fresh.run(["folders", "list", "--path", "/api", "--json", ...P], {
      listFolders: async () => folders,
    });
    expect(JSON.parse(nested.out)).toEqual(folders);
    expect(nested.fake.called("listFolders")[0]?.args).toEqual(["app", "dev", { path: "/api" }]);
  });

  it("an empty folder says so on stderr and prints nothing on stdout", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["folders", "list", ...P], { listFolders: async () => [] });
    expect(r.out).toBe("");
    expect(r.err).toContain("No folders in dev:/");
  });
});

describe("anchor folders create", () => {
  it('create normalizes "api/" to "/api" in the request', async () => {
    const cli = await loggedIn();
    const r = await cli.run(["folders", "create", "api/", ...P], {
      createFolder: async () => ({ folder: { path: "/api", name: "api" }, created: true }),
    });
    expect(r.code).toBe(0);
    expect(r.fake.called("createFolder")[0]?.args).toEqual(["app", "dev", { path: "/api" }]);
    expect(r.out).toContain("Created folder /api in dev");

    const again = await (await loggedIn()).run(["folders", "create", "/api", "--json", ...P], {
      createFolder: async () => ({ folder: { path: "/api", name: "api" }, created: false }),
    });
    expect(JSON.parse(again.out)).toEqual({
      folder: { path: "/api", name: "api" },
      created: false,
    });
  });

  it("an invalid or root path is a usage error with no request", async () => {
    const cli = await loggedIn();
    for (const [bad, message] of [
      ["/", "The root folder always exists"],
      ["a b", "Invalid folder path 'a b'"],
      ["../x", "Invalid folder path '../x'"],
    ] as const) {
      const r = await cli.run(["folders", "create", bad, ...P]);
      expect(r.code).toBe(2);
      expect(r.err).toContain(message);
      expect(r.fake.calls).toEqual([]);
    }
  });
});

describe("anchor folders delete", () => {
  it("delete non-TTY without --yes -> exit 2, no request", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["folders", "delete", "/api", ...P]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("Refusing to continue without --yes");
    expect(r.fake.calls).toEqual([]);
  });

  it("delete non-empty without --force -> exit 6 with hint", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["folders", "delete", "/api", "--yes", ...P], {
      deleteFolder: async () => Promise.reject(apiError(409, "conflict", "Folder is not empty")),
    });
    expect(r.code).toBe(6);
    expect(r.err).toContain("error: Folder is not empty");
    expect(r.err).toContain("hint: Re-run with --force to delete its secrets and subfolders.");
    expect(r.fake.called("deleteFolder")[0]?.args).toEqual([
      "app",
      "dev",
      { path: "/api", force: false },
    ]);
  });

  it("--force --yes sends force=true", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["folders", "delete", "api", "--force", "--yes", ...P], {
      deleteFolder: async () => undefined,
    });
    expect(r.code).toBe(0);
    expect(r.fake.called("deleteFolder")[0]?.args).toEqual([
      "app",
      "dev",
      { path: "/api", force: true },
    ]);
    expect(r.out).toContain("Deleted folder /api from dev");
  });

  it("in a terminal the confirmation says --force deletes secrets", async () => {
    const cli = await loggedIn({ tty: true, prompts: { confirm: [true, false] } });
    await cli.run(["folders", "delete", "/api", "--force", ...P], {
      deleteFolder: async () => undefined,
    });
    const declined = await cli.run(["folders", "delete", "/web", ...P]);
    expect(declined.code).toBe(1);
    expect(declined.fake.calls).toEqual([]);
    expect(cli.prompts.calls.map((c) => c.message)).toEqual([
      "Delete folder /api in dev and every secret and subfolder in it?",
      "Delete empty folder /web in dev?",
    ]);
  });
});
