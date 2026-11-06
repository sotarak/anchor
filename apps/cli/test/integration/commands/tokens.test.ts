import type { ServiceTokenDto } from "@anchor/shared";
import { describe, expect, it } from "vitest";
import { parseScope } from "#src/commands/tokens";
import { CliError, EXIT } from "#src/errors";
import { apiError, loggedIn } from "#test/support";

const TOKEN = "anc_st_SECRETTOKENCANARY";
const DAY = 86_400_000;
const dto = (over: Partial<ServiceTokenDto> = {}): ServiceTokenDto => ({
  id: "tok_1",
  name: "ci",
  tokenPrefix: "anc_st_SECRE",
  projectSlug: "app",
  permission: "read",
  scopes: [{ environment: "dev", path: "/" }],
  createdAt: Date.UTC(2026, 10, 1),
  expiresAt: Date.UTC(2027, 0, 30),
  lastUsedAt: null,
  revokedAt: null,
  ...over,
});
const created = { serviceToken: dto(), token: TOKEN };
const P = ["--project", "app"];

describe("parseScope", () => {
  it("parseScope accepts env and env:path; rejects 'Prod', 'prod:/../x', ':/api'", () => {
    expect(parseScope("prod")).toEqual({ environment: "prod", path: "/" });
    expect(parseScope("prod:/api")).toEqual({ environment: "prod", path: "/api" });
    expect(parseScope("prod:api/v1/")).toEqual({ environment: "prod", path: "/api/v1" });
    for (const bad of ["Prod", "prod:/../x", ":/api", ""]) {
      let err: unknown;
      try {
        parseScope(bad);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(CliError);
      expect([
        (err as CliError).exitCode,
        (err as CliError).message,
        (err as CliError).hint,
      ]).toEqual([EXIT.USAGE, `Invalid scope '${bad}'`, "Use <env> or <env>:<path>"]);
    }
  });
});

describe("anchor tokens create", () => {
  it("create sends the documented body with defaults (read, 90 days, current env, path /)", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["tokens", "create", "--name", "ci", ...P, "--env", "staging"], {
      createServiceToken: async () => created,
    });
    expect(r.code).toBe(0);
    expect(r.fake.called("createServiceToken")[0]?.args).toEqual([
      "app",
      {
        name: "ci",
        permission: "read",
        scopes: [{ environment: "staging", path: "/" }],
        expiresInDays: 90,
      },
    ]);
  });

  it("create passes repeated scopes, permission and expiry", async () => {
    const cli = await loggedIn();
    const r = await cli.run(
      [
        "tokens",
        "create",
        "--name",
        "deploy",
        "--scope",
        "prod",
        "--scope",
        "prod:/api",
        "--permission",
        "read-write",
        "--expires-in",
        "7",
        ...P,
      ],
      { createServiceToken: async () => created },
    );
    expect(r.code).toBe(0);
    expect(r.fake.called("createServiceToken")[0]?.args[1]).toEqual({
      name: "deploy",
      permission: "read-write",
      scopes: [
        { environment: "prod", path: "/" },
        { environment: "prod", path: "/api" },
      ],
      expiresInDays: 7,
    });
  });

  it("create prints the token only on stdout and the warning on stderr", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["tokens", "create", "--name", "ci", ...P], {
      createServiceToken: async () => created,
    });
    expect(r.out).toBe(`${TOKEN}\n`);
    expect(r.err).toContain("Created service token ci (read), expires 2027-01-30T00:00:00.000Z");
    expect(r.err).toContain("Store this token now; it will not be shown again.");
    expect(r.err).not.toContain("SECRETTOKENCANARY");

    const json = await loggedIn();
    const j = await json.run(["tokens", "create", "--name", "ci", "--json", ...P], {
      createServiceToken: async () => created,
    });
    expect(JSON.parse(j.out)).toEqual(created);
    expect(j.err).not.toContain("SECRETTOKENCANARY");
  });

  it("--expires-in 0 and 366 exit 2", async () => {
    for (const days of ["0", "366", "1.5", "ten"]) {
      const cli = await loggedIn();
      const r = await cli.run(["tokens", "create", "--name", "ci", "--expires-in", days, ...P], {
        createServiceToken: async () => created,
      });
      expect(r.code).toBe(2);
      expect(r.err).toContain(
        "error: --expires-in must be a whole number of days between 1 and 365",
      );
      expect(r.fake.calls).toEqual([]);
    }
  });

  it("--name is required and --permission is validated", async () => {
    const cli = await loggedIn();
    expect((await cli.run(["tokens", "create", ...P], {})).code).toBe(2);
    const bad = await loggedIn();
    expect(
      (await bad.run(["tokens", "create", "--name", "x", "--permission", "admin", ...P], {})).code,
    ).toBe(2);
  });

  it("403 from create -> exit 4", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["tokens", "create", "--name", "ci", ...P], {
      createServiceToken: async () => Promise.reject(apiError(403, "forbidden", "Forbidden")),
    });
    expect(r.code).toBe(4);
    expect(r.out).toBe("");
  });
});

describe("anchor tokens list", () => {
  it("list renders status from revokedAt/expiresAt", async () => {
    const now = Date.now();
    const tokens = [
      dto({ id: "a", name: "live", expiresAt: now + DAY, lastUsedAt: Date.UTC(2026, 10, 5) }),
      dto({ id: "b", name: "old", expiresAt: now - DAY }),
      dto({
        id: "c",
        name: "gone",
        expiresAt: now + DAY,
        revokedAt: now - 1,
        permission: "read-write",
        scopes: [
          { environment: "dev", path: "/" },
          { environment: "prod", path: "/api" },
        ],
      }),
    ];
    const cli = await loggedIn();
    const r = await cli.run(["tokens", "list", ...P], { listServiceTokens: async () => tokens });
    expect(r.code).toBe(0);
    const lines = r.out.trimEnd().split("\n");
    expect(lines[0]).toMatch(
      /^ID\s+NAME\s+PREFIX\s+PERMISSION\s+SCOPES\s+EXPIRES\s+LAST USED\s+STATUS$/,
    );
    expect(lines[1]).toMatch(
      /^a\s+live\s+anc_st_SECRE\s+read\s+dev:\/\s+\S+\s+2026-11-05\s+active$/,
    );
    expect(lines[2]).toMatch(/^b\s+old .*never\s+expired$/);
    expect(lines[3]).toMatch(
      /^c\s+gone\s+anc_st_SECRE\s+read-write\s+dev:\/,prod:\/api\s.*revoked$/,
    );

    const json = await loggedIn();
    const j = await json.run(["tokens", "list", "--json", ...P], {
      listServiceTokens: async () => tokens,
    });
    expect(JSON.parse(j.out)).toEqual({ serviceTokens: tokens });
  });
});

describe("anchor tokens revoke", () => {
  it("revoke in non-TTY without --yes exits 2 and does not call the API", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["tokens", "revoke", "tok_1", ...P], {
      revokeServiceToken: async () => {},
    });
    expect(r.code).toBe(2);
    expect(r.fake.calls).toEqual([]);
  });

  it("revoke with --yes calls the API; a TTY asks first", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["tokens", "revoke", "tok_1", "--yes", "--json", ...P], {
      revokeServiceToken: async () => {},
    });
    expect(r.code).toBe(0);
    expect(r.fake.called("revokeServiceToken")[0]?.args).toEqual(["app", "tok_1"]);
    expect(JSON.parse(r.out)).toEqual({ revoked: "tok_1" });

    const tty = await loggedIn({ tty: true, prompts: { confirm: [true] } });
    const t = await tty.run(["tokens", "revoke", "tok_1", ...P], {
      revokeServiceToken: async () => {},
    });
    expect(t.code).toBe(0);
    expect(tty.prompts.calls.map((c) => c.message)).toEqual(["Revoke service token tok_1?"]);
    expect(t.out).toBe("Revoked service token tok_1\n");
  });
});
