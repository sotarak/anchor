import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SecretDto } from "@anchor/shared";
import { describe, expect, it } from "vitest";
import { apiError, loggedIn } from "#test/support";

const CANARY = "VALUE-CANARY-7f3a";
const meta = (key: string, version = 1, extra: Partial<SecretDto> = {}): SecretDto => ({
  key,
  path: "/",
  version,
  comment: "",
  updatedAt: Date.UTC(2026, 10, 2),
  ...extra,
});
const P = ["--project", "app", "--env", "dev"];

describe("anchor secrets set", () => {
  it("set reads stdin and strips exactly one trailing newline", async () => {
    const cli = await loggedIn({ stdin: "a\n\n" });
    const r = await cli.run(["secrets", "set", "KEY", ...P], {
      listSecrets: async () => [],
      putSecret: async () => ({ secret: meta("KEY"), created: true }),
    });
    expect(r.code).toBe(0);
    expect(r.fake.called("putSecret")[0]?.args).toEqual([
      "app",
      "dev",
      "KEY",
      { value: "a\n", path: "/" },
    ]);
  });

  it("set with empty stdin (</dev/null, a bare newline) exits 2 and never overwrites the secret", async () => {
    for (const stdin of ["", "\n"]) {
      const cli = await loggedIn({ stdin });
      const r = await cli.run(["secrets", "set", "API_KEY", ...P], {});
      expect(r.code).toBe(2);
      expect(r.err).toContain("error: No value on stdin for API_KEY");
      expect(r.err).toContain("hint: Pipe the value, or use --from-file <path> for an empty value");
      expect(r.fake.calls).toEqual([]);
    }
  });

  it("set --from-file with an empty file sets an empty value", async () => {
    const cli = await loggedIn();
    await writeFile(join(cli.dir, "empty"), "");
    const r = await cli.run(["secrets", "set", "EMPTY", "--from-file", "empty", ...P], {
      listSecrets: async () => [],
      putSecret: async () => ({ secret: meta("EMPTY"), created: true }),
    });
    expect(r.code).toBe(0);
    expect(r.fake.called("putSecret")[0]?.args[3]).toHaveProperty("value", "");
  });

  it("set --from-file keeps exact bytes including trailing newline", async () => {
    const cli = await loggedIn();
    const pem = "-----BEGIN KEY-----\nabc\n-----END KEY-----\n";
    await writeFile(join(cli.dir, "key.pem"), pem);
    const r = await cli.run(["secrets", "set", "TLS_KEY", "--from-file", "key.pem", ...P], {
      listSecrets: async () => [],
      putSecret: async () => ({ secret: meta("TLS_KEY"), created: true }),
    });
    expect(r.code).toBe(0);
    expect(r.fake.called("putSecret")[0]?.args[3]).toHaveProperty("value", pem);
  });

  it("set --from-file with a missing file exits 2 before calling the API", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["secrets", "set", "K", "--from-file", "nope.txt", ...P], {});
    expect(r.code).toBe(2);
    expect(r.err).toContain("error: Cannot read nope.txt");
    expect(r.fake.calls).toEqual([]);
  });

  it("set prompts hidden in TTY", async () => {
    const cli = await loggedIn({ tty: true, prompts: { password: [CANARY] } });
    const r = await cli.run(["secrets", "set", "KEY", ...P], {
      listSecrets: async () => [],
      putSecret: async () => ({ secret: meta("KEY"), created: true }),
    });
    expect(r.code).toBe(0);
    expect(cli.prompts.calls).toEqual([{ kind: "password", message: "Value for KEY" }]);
    expect(r.fake.called("putSecret")[0]?.args[3]).toHaveProperty("value", CANARY);
  });

  it("set rejects 65537-byte value before calling the API", async () => {
    const cli = await loggedIn({ stdin: "x".repeat(65537) });
    const r = await cli.run(["secrets", "set", "BIG", ...P], {});
    expect(r.code).toBe(2);
    expect(r.err).toContain("error: Value for BIG exceeds 65536 bytes");
    expect(r.fake.calls).toEqual([]);
  });

  it("set never writes the value to stdout or stderr (canary)", async () => {
    for (const flags of [[], ["--json"], ["--debug"]]) {
      const cli = await loggedIn({ stdin: CANARY });
      const r = await cli.run(["secrets", "set", "KEY", ...P, ...flags], {
        listSecrets: async () => [],
        putSecret: async () => ({ secret: meta("KEY"), created: true }),
      });
      expect(r.code).toBe(0);
      expect(r.out + r.err).not.toContain(CANARY);
    }
  });

  it("set reports Created/Updated/Unchanged", async () => {
    const created = await loggedIn({ stdin: "v" });
    const c = await created.run(["secrets", "set", "KEY", ...P, "--path", "/api"], {
      listSecrets: async () => [],
      putSecret: async () => ({ secret: meta("KEY", 1, { path: "/api" }), created: true }),
    });
    expect(c.out).toBe("Created KEY (v1) in dev:/api\n");
    expect(c.fake.called("listSecrets")[0]?.args).toEqual([
      "app",
      "dev",
      { path: "/api", reveal: false },
    ]);

    const updated = await loggedIn({ stdin: "v" });
    const u = await updated.run(["secrets", "set", "KEY", ...P], {
      listSecrets: async () => [meta("KEY", 1), meta("OTHER", 9)],
      putSecret: async () => ({ secret: meta("KEY", 2), created: false }),
    });
    expect(u.out).toBe("Updated KEY (v2) in dev:/\n");

    const same = await loggedIn({ stdin: "v" });
    const s = await same.run(["secrets", "set", "KEY", ...P], {
      listSecrets: async () => [meta("KEY", 4)],
      putSecret: async () => ({ secret: meta("KEY", 4), created: false }),
    });
    expect(s.out).toBe("Unchanged KEY (v4)\n");

    const json = await loggedIn({ stdin: "v" });
    const j = await json.run(["secrets", "set", "KEY", "--json", ...P], {
      listSecrets: async () => [],
      putSecret: async () => ({ secret: meta("KEY"), created: true }),
    });
    expect(JSON.parse(j.out)).toEqual({ secret: meta("KEY"), created: true });
  });

  it("set keeps the existing comment unless --comment is given", async () => {
    const keep = await loggedIn({ stdin: "v" });
    const k = await keep.run(["secrets", "set", "KEY", ...P], {
      listSecrets: async () => [meta("KEY", 1, { comment: "primary db" })],
      putSecret: async () => ({ secret: meta("KEY", 2), created: false }),
    });
    expect(k.fake.called("putSecret")[0]?.args[3]).toEqual({
      value: "v",
      path: "/",
      comment: "primary db",
    });

    const change = await loggedIn({ stdin: "v" });
    const c = await change.run(["secrets", "set", "KEY", "--comment", "new", ...P], {
      listSecrets: async () => [meta("KEY", 1, { comment: "primary db" })],
      putSecret: async () => ({ secret: meta("KEY", 2), created: false }),
    });
    expect(c.fake.called("putSecret")[0]?.args[3]).toEqual({
      value: "v",
      path: "/",
      comment: "new",
    });
  });

  it("set KEY=value is rejected without echoing the value", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["secrets", "set", `KEY=${CANARY}`, ...P], {});
    expect(r.code).toBe(2);
    expect(r.err).not.toContain(CANARY);
    expect(r.fake.calls).toEqual([]);
  });
});

describe("anchor secrets get", () => {
  const withValue = { ...meta("DB_URL", 3, { comment: "primary" }), value: CANARY };

  it("get in TTY masks without --reveal; piped prints raw value with no added newline; --json follows the same rule", async () => {
    const tty = await loggedIn({ tty: true });
    const masked = await tty.run(["secrets", "get", "DB_URL", ...P], {
      listSecrets: async () => [meta("DB_URL", 3, { comment: "primary" })],
    });
    expect(masked.code).toBe(0);
    expect(masked.out).not.toContain(CANARY);
    expect(masked.out).toContain("********");
    expect(masked.out).toContain("DB_URL");
    expect(masked.err).toContain("Use --reveal to show the value");
    // Masked output never fetches the value, so no read is recorded server-side.
    expect(masked.fake.called("getSecret")).toEqual([]);

    const revealed = await loggedIn({ tty: true });
    const rv = await revealed.run(["secrets", "get", "DB_URL", "--reveal", ...P], {
      getSecret: async () => withValue,
    });
    expect(rv.out).toContain(CANARY);

    const piped = await loggedIn();
    const p = await piped.run(["secrets", "get", "DB_URL", ...P], {
      getSecret: async () => withValue,
    });
    expect(p.code).toBe(0);
    expect(p.out).toBe(CANARY);
    expect(p.fake.called("getSecret")[0]?.args).toEqual([
      "app",
      "dev",
      "DB_URL",
      { path: "/", expand: true, includeImports: true },
    ]);

    const ttyJson = await loggedIn({ tty: true });
    const tj = await ttyJson.run(["secrets", "get", "DB_URL", "--json", ...P], {
      listSecrets: async () => [meta("DB_URL", 3, { comment: "primary" })],
    });
    expect(JSON.parse(tj.out)).toEqual({ secret: meta("DB_URL", 3, { comment: "primary" }) });

    const pipedJson = await loggedIn();
    const pj = await pipedJson.run(["secrets", "get", "DB_URL", "--json", ...P], {
      getSecret: async () => withValue,
    });
    expect(JSON.parse(pj.out)).toEqual({ secret: withValue });
  });

  it("masked get finds a local key without the imports, so a forbidden import does not block it", async () => {
    const IMPORT_DENIED = "You do not have permission to read the import dev:/billing of dev:/";
    const listSecrets = async (_p: string, _e: string, q: { includeImports?: boolean }) => {
      if (q.includeImports) throw apiError(403, "forbidden", IMPORT_DENIED);
      return [meta("DB_URL", 3)];
    };
    const tty = await loggedIn({ tty: true });
    const r = await tty.run(["secrets", "get", "DB_URL", ...P], { listSecrets });
    expect(r.code).toBe(0);
    expect(r.out).toContain("DB_URL");
    expect(r.fake.called("listSecrets")).toHaveLength(1);

    // Not local: the imports decide, and the server's 403 stands.
    const other = await loggedIn({ tty: true });
    const missing = await other.run(["secrets", "get", "KEY", ...P], { listSecrets });
    expect(missing.code).toBe(4);
    expect(missing.err).toContain(IMPORT_DENIED);
  });

  it("masked get falls back to the imports for a key that is not local", async () => {
    const tty = await loggedIn({ tty: true });
    const imported = {
      ...meta("SHARED", 1),
      importedFrom: { environment: "dev", path: "/billing" },
    };
    const r = await tty.run(["secrets", "get", "SHARED", ...P], {
      listSecrets: async (_p: string, _e: string, q: { includeImports?: boolean }) =>
        q.includeImports ? [meta("DB_URL"), imported] : [meta("DB_URL")],
    });
    expect(r.code).toBe(0);
    expect(r.out).toContain("dev:/billing");
    expect(r.fake.called("listSecrets").map((c) => c.args[2])).toEqual([
      { path: "/", reveal: false },
      { path: "/", reveal: false, includeImports: true },
    ]);
  });

  it("masked get of a missing key exits 5", async () => {
    const cli = await loggedIn({ tty: true });
    const r = await cli.run(["secrets", "get", "NOPE", ...P], { listSecrets: async () => [] });
    expect(r.code).toBe(5);
    expect(r.err).toContain("error: Secret NOPE not found in dev:/");
  });
});

describe("anchor secrets list", () => {
  it("list --json has values only with --reveal", async () => {
    const plain = await loggedIn();
    const p = await plain.run(["secrets", "list", "--json", ...P], {
      listSecrets: async () => [meta("A"), meta("B", 2)],
    });
    expect(JSON.parse(p.out)).toEqual({ secrets: [meta("A"), meta("B", 2)] });
    expect(p.fake.called("listSecrets")[0]?.args).toEqual([
      "app",
      "dev",
      { path: "/", reveal: false },
    ]);

    const reveal = await loggedIn();
    const r = await reveal.run(["secrets", "list", "--json", "--reveal", ...P], {
      listSecrets: async () => [{ ...meta("A"), value: CANARY }],
    });
    expect(JSON.parse(r.out).secrets[0].value).toBe(CANARY);
    expect(r.fake.called("listSecrets")[0]?.args).toEqual([
      "app",
      "dev",
      { path: "/", reveal: true },
    ]);
  });

  it("list renders a table, with VALUE only under --reveal", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["secrets", "list", ...P], {
      listSecrets: async () => [meta("A", 1, { comment: "first" }), meta("LONG_KEY", 12)],
    });
    expect(r.out).toBe(
      [
        "KEY       VERSION  UPDATED     COMMENT",
        "A         1        2026-11-02  first",
        "LONG_KEY  12       2026-11-02",
        "",
      ].join("\n"),
    );
    const rev = await loggedIn();
    const rv = await rev.run(["secrets", "list", "--reveal", ...P], {
      listSecrets: async () => [{ ...meta("A"), value: CANARY }],
    });
    expect(rv.out.split("\n")[0]).toBe("KEY  VERSION  UPDATED     COMMENT  VALUE");
    expect(rv.out).toContain(CANARY);
  });
});

describe("anchor secrets delete", () => {
  it("delete in non-TTY without --yes exits 2 and does not call the API", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["secrets", "delete", "KEY", ...P], {
      deleteSecret: async () => {},
    });
    expect(r.code).toBe(2);
    expect(r.err).toContain("error: Refusing to continue without --yes in non-interactive mode");
    expect(r.fake.calls).toEqual([]);
  });

  it("delete with --yes calls the API", async () => {
    const cli = await loggedIn();
    const r = await cli.run(
      ["secrets", "delete", "KEY", "--yes", "--json", ...P, "--path", "/api"],
      {
        deleteSecret: async () => {},
      },
    );
    expect(r.code).toBe(0);
    expect(r.fake.called("deleteSecret")[0]?.args).toEqual(["app", "dev", "KEY", { path: "/api" }]);
    expect(JSON.parse(r.out)).toEqual({
      deleted: { key: "KEY", environment: "dev", path: "/api" },
    });
  });

  it("delete in a TTY asks for confirmation", async () => {
    const cli = await loggedIn({ tty: true, prompts: { confirm: [true] } });
    const r = await cli.run(["secrets", "delete", "KEY", ...P], { deleteSecret: async () => {} });
    expect(r.code).toBe(0);
    expect(cli.prompts.calls.map((c) => c.message)).toEqual(["Delete KEY from app/dev:/?"]);
    expect(r.out).toBe("Deleted KEY from dev:/\n");
  });
});

describe("secrets errors", () => {
  it("invalid key '1BAD' exits 2", async () => {
    for (const sub of [["get"], ["set"], ["delete", "--yes"]]) {
      const cli = await loggedIn({ stdin: "v" });
      const r = await cli.run(["secrets", ...sub, "1BAD", ...P], {});
      expect(r.code).toBe(2);
      expect(r.err).toContain("error: Invalid key '1BAD'");
      expect(r.fake.calls).toEqual([]);
    }
  });

  it("API 404 -> exit 5, 403 -> exit 4, 409 -> exit 6", async () => {
    const cases = [
      [apiError(404, "not_found", "Secret not found"), 5],
      [apiError(403, "forbidden", "Forbidden"), 4],
      [apiError(409, "conflict", "Concurrent write"), 6],
    ] as const;
    for (const [error, code] of cases) {
      const cli = await loggedIn({ stdin: "v" });
      const r = await cli.run(["secrets", "set", "KEY", ...P], {
        listSecrets: async () => [],
        putSecret: async () => Promise.reject(error),
      });
      expect(r.code).toBe(code);
      expect(r.err).toContain(`error: ${error.message}`);
    }
    const get = await loggedIn();
    const g = await get.run(["secrets", "get", "KEY", ...P], {
      getSecret: async () => Promise.reject(apiError(404, "not_found", "Secret not found")),
    });
    expect(g.code).toBe(5);
  });

  it("secrets commands require a project", async () => {
    const cli = await loggedIn();
    expect((await cli.run(["secrets", "list"], {})).code).toBe(2);
  });
});
