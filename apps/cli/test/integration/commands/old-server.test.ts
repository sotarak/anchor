import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SecretDto } from "@anchor/shared";
import { describe, expect, it } from "vitest";
import { loggedIn } from "#test/support";

/** A 0.3.x server's DTO: no `type`, no `sensitive`. */
const old = (key: string, version = 1): SecretDto =>
  ({ key, path: "/", version, comment: "", updatedAt: 0 }) as unknown as SecretDto;
const P = ["--project", "app", "--env", "dev"];

describe("CLI 0.4.0 against a 0.3.x server", () => {
  it("secrets list shows string and keeps values masked", async () => {
    const cli = await loggedIn();
    const r = await cli.run(["secrets", "list", ...P], {
      listSecrets: async () => [old("DB_URL")],
    });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/DB_URL\s+string\s+1/);
    expect(r.out).not.toContain("VALUE");
  });

  it("secrets get in a terminal masks the value", async () => {
    const cli = await loggedIn({ tty: true });
    const r = await cli.run(["secrets", "get", "DB_URL", ...P], {
      listSecrets: async () => [old("DB_URL")],
    });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/VALUE\s+\*{8}/);
    expect(r.err).toContain("Use --reveal to show the value");
  });

  it("secrets set --type fails loudly when the server ignored the type", async () => {
    const cli = await loggedIn({ stdin: "8080" });
    const r = await cli.run(
      ["secrets", "set", "PORT", "--type", "number", "--no-sensitive", ...P],
      {
        listSecrets: async () => [],
        putSecret: async () => ({ secret: old("PORT"), created: true }),
      },
    );
    expect(r.code).toBe(1);
    expect(r.err).toContain(
      "error: The server is older than 0.4.0 and stored PORT as a sensitive string",
    );
    expect(r.err).toContain("hint: Upgrade the server to 0.4.0 to use types and plain config");
  });

  it("secrets set without type flags still works", async () => {
    const cli = await loggedIn({ stdin: "x" });
    const r = await cli.run(["secrets", "set", "A", ...P], {
      listSecrets: async () => [],
      putSecret: async () => ({ secret: old("A"), created: true }),
    });
    expect(r.code).toBe(0);
  });

  it("secrets import stops at the first typed key the server ignored", async () => {
    const cli = await loggedIn();
    await writeFile(join(cli.dir, "c.yaml"), "a_key: x\nport: 9000\nz: y\n");
    const r = await cli.run(["secrets", "import", "--from-file", "c.yaml", ...P], {
      listSecrets: async () => [],
      putSecret: async (_p, _e, key) => ({ secret: old(key), created: true }),
    });
    expect(r.code).toBe(1);
    expect(r.fake.called("putSecret").map((c) => c.args[2])).toEqual(["A_KEY", "PORT"]);
    expect(r.err).toContain(
      "error: Imported 1 of 3; the server is older than 0.4.0 and stored PORT as a sensitive string",
    );
    expect(r.err).toContain("hint: Upgrade the server to 0.4.0, then re-run with --overwrite");
  });
});
