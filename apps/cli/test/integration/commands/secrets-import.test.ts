import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SecretDto } from "@anchor/shared";
import { describe, expect, it } from "vitest";
import type { ApiClient } from "#src/api/client";
import { apiError, type LoggedIn, loggedIn } from "#test/support";

const meta = (key: string, version = 1, extra: Partial<SecretDto> = {}): SecretDto => ({
  key,
  path: "/",
  version,
  comment: "",
  updatedAt: 0,
  type: "string",
  sensitive: true,
  ...extra,
});
const P = ["--project", "app", "--env", "dev"];

/** A folder holding `existing`; a PUT to an existing key with `same` content keeps its version. */
function folder(existing: SecretDto[] = [], opts: { failOn?: string; same?: string[] } = {}) {
  const api: Partial<ApiClient> = {
    listSecrets: async () => existing,
    putSecret: async (_p, _e, key) => {
      if (key === opts.failOn) throw apiError(409, "conflict", "Secret was changed concurrently");
      const prev = existing.find((x) => x.key === key);
      if (!prev) return { secret: meta(key), created: true };
      const version = opts.same?.includes(key) ? prev.version : prev.version + 1;
      return { secret: meta(key, version), created: false };
    },
  };
  return api;
}

async function withFile(cli: LoggedIn, name: string, text: string) {
  await writeFile(join(cli.dir, name), text);
}

describe("anchor secrets import", () => {
  it("creates new keys with types and flags", async () => {
    const cli = await loggedIn();
    await withFile(cli, "config.yaml", "port: 9000\napi_key: sk\n");
    const r = await cli.run(
      ["secrets", "import", "--from-file", "config.yaml", "--non-sensitive", "PORT", ...P],
      folder(),
    );
    expect(r.err).toBe("Writing 2 secrets to dev:/...\n");
    expect(r.code).toBe(0);
    expect(r.fake.called("listSecrets")[0]?.args).toEqual([
      "app",
      "dev",
      { path: "/", reveal: false },
    ]);
    expect(r.fake.called("putSecret").map((c) => c.args)).toEqual([
      ["app", "dev", "API_KEY", { value: "sk", path: "/", type: "string", sensitive: true }],
      ["app", "dev", "PORT", { value: "9000", path: "/", type: "number", sensitive: false }],
    ]);
    expect(r.out).toMatch(/KEY\s+TYPE\s+SENSITIVE\s+ACTION/);
    expect(r.out).toMatch(/PORT\s+number\s+no\s+create/);
    expect(r.out).toContain("Created 2, updated 0, skipped 0 existing, 0 empty in dev:/");
  });

  it("skips existing keys unless --overwrite", async () => {
    const existing = [meta("API_KEY", 3, { comment: "kept" }), meta("PORT", 2)];
    const yaml = "port: 9000\napi_key: sk\nnew_one: x\n";
    const skip = await loggedIn();
    await withFile(skip, "c.yaml", yaml);
    const r = await skip.run(
      ["secrets", "import", "--from-file", "c.yaml", ...P],
      folder(existing),
    );
    expect(r.code).toBe(0);
    expect(r.fake.called("putSecret").map((c) => c.args[2])).toEqual(["NEW_ONE"]);
    expect(r.out).toMatch(/API_KEY\s+string\s+yes\s+skip/);
    expect(r.out).toContain("Created 1, updated 0, skipped 2 existing, 0 empty in dev:/");

    const over = await loggedIn();
    await withFile(over, "c.yaml", yaml);
    const o = await over.run(
      [
        "secrets",
        "import",
        "--from-file",
        "c.yaml",
        "--overwrite",
        "--non-sensitive",
        "PORT",
        "--json",
        ...P,
      ],
      folder(existing, { same: ["API_KEY"] }),
    );
    expect(o.code).toBe(0);
    expect(o.fake.called("putSecret").map((c) => c.args.slice(2))).toEqual([
      ["API_KEY", { value: "sk", path: "/", type: "string", sensitive: true, comment: "kept" }],
      ["NEW_ONE", { value: "x", path: "/", type: "string", sensitive: true }],
      ["PORT", { value: "9000", path: "/", type: "number", sensitive: false }],
    ]);
    expect(JSON.parse(o.out)).toEqual({
      created: ["NEW_ONE"],
      updated: ["PORT"],
      unchanged: ["API_KEY"],
      skipped: [],
      empty: [],
    });
  });

  it("--dry-run writes nothing", async () => {
    const existing = [meta("API_KEY")];
    const yaml = "port: 9000\napi_key: sk\nblank:\n";
    const cli = await loggedIn();
    await withFile(cli, "c.yaml", yaml);
    const r = await cli.run(
      ["secrets", "import", "--from-file", "c.yaml", "--dry-run", ...P],
      folder(existing),
    );
    expect(r.code).toBe(0);
    expect(r.fake.called("putSecret")).toEqual([]);
    expect(r.out).toMatch(/KEY\s+TYPE\s+SENSITIVE\s+ACTION/);
    expect(r.out).toMatch(/PORT\s+number\s+yes\s+create/);
    expect(r.out).toMatch(/API_KEY\s+string\s+yes\s+skip/);
    expect(r.out).toMatch(/blank\s+–\s+–\s+empty/);
    expect(r.out).toContain("Dry run: would create 1, update 0, skip 1 existing, 1 empty in dev:/");

    const json = await loggedIn();
    await withFile(json, "c.yaml", yaml);
    const j = await json.run(
      ["secrets", "import", "--from-file", "c.yaml", "--dry-run", "--overwrite", "--json", ...P],
      folder(existing),
    );
    expect(j.fake.called("putSecret")).toEqual([]);
    expect(JSON.parse(j.out)).toEqual({
      dryRun: true,
      created: ["PORT"],
      updated: ["API_KEY"],
      unchanged: [],
      skipped: [],
      empty: ["blank"],
    });
  });

  it("--non-sensitive is repeatable", async () => {
    const cli = await loggedIn();
    await withFile(cli, "c.yaml", "port: 1\nhost: h\napi_key: k\n");
    const r = await cli.run(
      [
        "secrets",
        "import",
        "--from-file",
        "c.yaml",
        "--non-sensitive",
        "PORT",
        "--non-sensitive",
        "HO?T",
        ...P,
      ],
      folder(),
    );
    expect(r.code).toBe(0);
    expect(
      r.fake
        .called("putSecret")
        .map((c) => [c.args[2], (c.args[3] as { sensitive: boolean }).sensitive]),
    ).toEqual([
      ["API_KEY", true],
      ["HOST", false],
      ["PORT", false],
    ]);
  });

  it("--comment is sent with every write", async () => {
    const cli = await loggedIn();
    await withFile(cli, "c.json", '{"a": "1", "b": "2"}');
    const r = await cli.run(
      ["secrets", "import", "--from-file", "c.json", "--comment", "from zepo", "--overwrite", ...P],
      folder([meta("B", 1, { comment: "old" })]),
    );
    expect(r.code).toBe(0);
    expect(
      r.fake.called("putSecret").map((c) => (c.args[3] as { comment?: string }).comment),
    ).toEqual(["from zepo", "from zepo"]);
  });

  it("stops at the first failure and resumes", async () => {
    const env = "K1=a\nK2=b\nK3=c\nK4=d\nK5=e\n";
    const cli = await loggedIn();
    await withFile(cli, ".env", env);
    const r = await cli.run(
      ["secrets", "import", "--from-file", ".env", ...P],
      folder([], { failOn: "K3" }),
    );
    expect(r.code).toBe(1);
    expect(r.fake.called("putSecret").map((c) => c.args[2])).toEqual(["K1", "K2", "K3"]);
    expect(r.err).toContain(
      "error: Imported 2 of 5; K3 failed: Secret was changed concurrently. Re-run to continue",
    );

    const again = await loggedIn();
    await withFile(again, ".env", env);
    const a = await again.run(
      ["secrets", "import", "--from-file", ".env", ...P],
      folder([meta("K1"), meta("K2")]),
    );
    expect(a.code).toBe(0);
    expect(a.fake.called("putSecret").map((c) => c.args[2])).toEqual(["K3", "K4", "K5"]);
    expect(a.out).toContain("Created 3, updated 0, skipped 2 existing, 0 empty in dev:/");
  });

  it("nothing reaches the network when the file is invalid", async () => {
    const cli = await loggedIn();
    await withFile(cli, "c.json", '{"a": {"b-c": "1", "b_c": "2"}}');
    const r = await cli.run(["secrets", "import", "--from-file", "c.json", ...P], folder());
    expect(r.code).toBe(2);
    expect(r.err).toContain("a.b-c and a.b_c both become A_B_C");
    expect(r.fake.calls).toEqual([]);
  });

  it("no values on stdout or stderr", async () => {
    const yaml = "a: s3cr3t-a\nb: s3cr3t-b\n";
    for (const extra of [[], ["--dry-run"], ["--json"], ["--dry-run", "--json"], ["--debug"]]) {
      const cli = await loggedIn();
      await withFile(cli, "c.yaml", yaml);
      const r = await cli.run(
        ["secrets", "import", "--from-file", "c.yaml", ...extra, ...P],
        folder(),
      );
      expect(r.code).toBe(0);
      expect(r.out + r.err).not.toContain("s3cr3t");
    }
    const failing = await loggedIn();
    await withFile(failing, "c.yaml", yaml);
    const f = await failing.run(
      ["secrets", "import", "--from-file", "c.yaml", ...P],
      folder([], { failOn: "A" }),
    );
    expect(f.code).toBe(1);
    expect(f.out + f.err).not.toContain("s3cr3t");
  });

  it("stdin needs --format", async () => {
    const bare = await loggedIn({ stdin: "PORT=1\n" });
    const r = await bare.run(["secrets", "import", ...P], folder());
    expect(r.code).toBe(2);
    expect(r.err).toContain("Pass --format dotenv|json|yaml when reading stdin");
    expect(r.fake.calls).toEqual([]);

    const ok = await loggedIn({ stdin: "PORT=1\n" });
    const o = await ok.run(["secrets", "import", "--format", "dotenv", ...P], folder());
    expect(o.code).toBe(0);
    expect(o.fake.called("putSecret")[0]?.args[2]).toBe("PORT");
  });

  it("a terminal stdin without --from-file is a usage error", async () => {
    const cli = await loggedIn({ tty: true });
    const r = await cli.run(["secrets", "import", "--format", "yaml", ...P], folder());
    expect(r.code).toBe(2);
    expect(r.err).toContain("Pass --from-file <path> or pipe the file on stdin");
  });

  it("an unknown extension needs --format", async () => {
    const cli = await loggedIn();
    await withFile(cli, "config.txt", "A=1\n");
    const r = await cli.run(["secrets", "import", "--from-file", "config.txt", ...P], folder());
    expect(r.code).toBe(2);
    expect(r.err).toContain("Cannot tell the format of config.txt");
    expect(r.err).toContain("Pass --format dotenv|json|yaml");
    expect(r.fake.calls).toEqual([]);
    const ok = await cli.run(
      ["secrets", "import", "--from-file", "config.txt", "--format", "dotenv", ...P],
      folder(),
    );
    expect(ok.code).toBe(0);
  });
});
