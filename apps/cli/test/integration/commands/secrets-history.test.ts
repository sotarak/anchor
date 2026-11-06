import type { SecretDto, SecretVersionDto } from "@anchor/shared";
import { describe, expect, it } from "vitest";
import { loggedIn } from "#test/support";

const P = ["--project", "app", "--env", "dev", "--path", "/api"];
const CANARY = "HISTORY-CANARY-v2";
const versions: SecretVersionDto[] = [
  {
    version: 3,
    comment: "rotate",
    createdAt: Date.UTC(2026, 10, 3),
    createdBy: { id: "u1", label: "a@x.io" },
  },
  { version: 2, comment: "", createdAt: Date.UTC(2026, 10, 2), createdBy: null },
  {
    version: 1,
    comment: "first",
    createdAt: Date.UTC(2026, 10, 1),
    createdBy: { id: "u1", label: "a@x.io" },
  },
];
const secret = (version: number): SecretDto => ({
  key: "DB_URL",
  path: "/api",
  version,
  comment: "first",
  updatedAt: 0,
});

describe("anchor secrets history", () => {
  it("history prints a table of versions", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["secrets", "history", "DB_URL", ...P], {
      listVersions: async () => versions,
    });
    expect(r.code).toBe(0);
    const lines = r.out.trim().split("\n");
    expect(lines[0]).toMatch(/^VERSION\s+COMMENT\s+AUTHOR\s+DATE$/);
    expect(lines[1]).toMatch(/^3\s+rotate\s+a@x\.io\s+/);
    expect(lines[2]).toMatch(/^2\s+–\s+–\s+/);
    expect(r.fake.called("listVersions")[0]?.args).toEqual([
      "app",
      "dev",
      "DB_URL",
      { path: "/api" },
    ]);
  });

  it("history --json is valid JSON array", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["secrets", "history", "DB_URL", "--json", ...P], {
      listVersions: async () => versions,
    });
    expect(JSON.parse(r.out)).toEqual(versions);
  });
});

describe("anchor secrets get --at-version", () => {
  it("get --at-version 2 prints the value only with --reveal or non-TTY", async () => {
    const value = { ...versions[1], value: CANARY } as SecretVersionDto & { value: string };
    const tty = await loggedIn({ tty: true });
    const masked = await tty.run(["secrets", "get", "DB_URL", "--at-version", "2", ...P], {
      listVersions: async () => versions,
    });
    expect(masked.code).toBe(0);
    expect(masked.out).not.toContain(CANARY);
    expect(masked.out).toContain("********");
    expect(masked.err).toContain("Use --reveal to show the value");
    expect(masked.fake.called("getSecretVersion")).toEqual([]);

    const revealed = await tty.run(
      ["secrets", "get", "DB_URL", "--at-version", "2", "--reveal", ...P],
      {
        getSecretVersion: async () => value,
      },
    );
    expect(revealed.out).toContain(CANARY);

    const piped = await loggedIn();
    const p = await piped.run(["secrets", "get", "DB_URL", "--at-version", "2", ...P], {
      getSecretVersion: async () => value,
    });
    expect(p.out).toBe(CANARY);
    expect(p.fake.called("getSecretVersion")[0]?.args).toEqual([
      "app",
      "dev",
      "DB_URL",
      2,
      { path: "/api" },
    ]);
  });

  it("--version after secrets get is a usage error, not the CLI version", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["secrets", "get", "DB_URL", "--version", "2", ...P]);
    expect(r.code).toBe(2);
    expect(r.out).toBe("");
    expect(r.err).toContain("hint: Use --at-version <n> to read a past version");
    expect(r.fake.calls).toEqual([]);
  });

  it("an unknown version in a masked view exits 5", async () => {
    const tty = await loggedIn({ tty: true });
    const r = await tty.run(["secrets", "get", "DB_URL", "--at-version", "9", ...P], {
      listVersions: async () => versions,
    });
    expect(r.code).toBe(5);
    expect(r.err).toContain("error: Version 9 of DB_URL not found in dev:/api");
  });

  it("--at-version must be a positive integer", async () => {
    const cli = await loggedIn();
    for (const bad of ["0", "abc", "-1", "1.5"]) {
      const r = await cli.run(["secrets", "get", "DB_URL", "--at-version", bad, ...P]);
      expect(r.code).toBe(2);
    }
  });
});

describe("anchor secrets rollback", () => {
  it("rollback non-TTY without --yes -> exit 2 and no API call", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["secrets", "rollback", "DB_URL", "--to", "1", ...P]);
    expect(r.code).toBe(2);
    expect(r.fake.calls).toEqual([]);
  });

  it("rollback in a terminal asks first", async () => {
    const cli = await loggedIn({ tty: true, prompts: { confirm: [true] } });
    const r = await cli.run(["secrets", "rollback", "DB_URL", "--to", "1", ...P], {
      rollbackSecret: async () => ({ secret: secret(4), changed: true }),
    });
    expect(r.code).toBe(0);
    expect(cli.prompts.calls.map((c) => c.message)).toEqual([
      "Roll back DB_URL in dev:/api to version 1?",
    ]);
  });

  it("rollback --yes prints the new version to stderr; --json prints to stdout", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["secrets", "rollback", "DB_URL", "--to", "1", "--yes", ...P], {
      rollbackSecret: async () => ({ secret: secret(4), changed: true }),
    });
    expect(r.code).toBe(0);
    expect(r.out).toBe("");
    expect(r.err).toContain("Rolled back to v1 (new version v4)");
    expect(r.fake.called("rollbackSecret")[0]?.args).toEqual([
      "app",
      "dev",
      "DB_URL",
      { path: "/api", version: 1 },
    ]);

    const same = await cli.run(["secrets", "rollback", "DB_URL", "--to", "1", "--yes", ...P], {
      rollbackSecret: async () => ({ secret: secret(3), changed: false }),
    });
    expect(same.err).toContain("Already at that content");

    const json = await cli.run(
      ["secrets", "rollback", "DB_URL", "--to", "1", "--yes", "--json", ...P],
      {
        rollbackSecret: async () => ({ secret: secret(4), changed: true }),
      },
    );
    expect(JSON.parse(json.out)).toEqual({ secret: secret(4), changed: true });
  });

  it("--to is required and must be a positive integer", async () => {
    const cli = await loggedIn();
    expect((await cli.run(["secrets", "rollback", "DB_URL", "--yes", ...P])).code).toBe(2);
    expect(
      (await cli.run(["secrets", "rollback", "DB_URL", "--to", "x", "--yes", ...P])).code,
    ).toBe(2);
  });
});
