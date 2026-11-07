import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cliRunner } from "./cli-process";
import { startAnchor } from "./harness";
import { tmpDirOutsideTest } from "./tmp";

const OWNER_PASSWORD = "e2e m5 owner passphrase";
const DB_PASSWORD = "m5-db-pw-71c";
const RAW = "postgres://u:${PASSWORD}@h/db";
const EXPANDED = `postgres://u:${DB_PASSWORD}@h/db`;
const PRINT_DB_URL = ["node", "-e", "process.stdout.write(process.env.DB_URL)"];
const P = ["--project", "m5", "--env", "dev"];

let anchor: Awaited<ReturnType<typeof startAnchor>>;
let home: string;
let cwd: string;
const cli = cliRunner(() => ({ home, cwd, apiUrl: anchor.url }));

beforeAll(async () => {
  anchor = await startAnchor();
  home = await tmpDirOutsideTest();
  cwd = join(home, "work");
  await mkdir(cwd);
  const setup = await fetch(`${anchor.url}/api/v1/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "owner@example.com",
      name: "Owner",
      password: OWNER_PASSWORD,
    }),
  });
  expect(setup.status).toBe(201);
  const login = await cli(["login", "--email", "owner@example.com", "--password-stdin"], {
    stdin: `${OWNER_PASSWORD}\n`,
  });
  expect(login.code, login.stderr).toBe(0);
  const { token } = (await (
    await fetch(`${anchor.url}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@example.com", password: OWNER_PASSWORD, client: "cli" }),
    })
  ).json()) as { token: string };
  const project = await fetch(`${anchor.url}/api/v1/projects`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: "M5", slug: "m5" }),
  });
  expect(project.status).toBe(201);
});

afterAll(async () => {
  await anchor?.stop();
});

describe("M5 CLI against a local Worker", () => {
  it("1. folders create /db, then secrets with a reference inside it", async () => {
    const folder = await cli(["folders", "create", "db/", ...P]);
    expect(folder.code, folder.stderr).toBe(0);
    expect(folder.stdout).toBe("Created folder /db in dev\n");
    for (const [key, value] of [
      ["PASSWORD", DB_PASSWORD],
      ["DB_URL", RAW],
    ] as const) {
      const r = await cli(["secrets", "set", key, "--path", "/db", ...P], { stdin: value });
      expect(r.code, r.stderr).toBe(0);
    }
  });

  it("2. folders list shows db", async () => {
    const r = await cli(["folders", "list", ...P]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe("db\n");
  });

  it("3. run --path /db expands the reference", async () => {
    const r = await cli(["run", "--path", "/db", ...P, "--", ...PRINT_DB_URL]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe(EXPANDED);
  });

  it("4. run --no-expand injects the stored value", async () => {
    const r = await cli(["run", "--no-expand", "--path", "/db", ...P, "--", ...PRINT_DB_URL]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe(RAW);
  });

  it("5. an unresolved reference fails closed with the --no-expand hint", async () => {
    const set = await cli(["secrets", "set", "BROKEN", "--path", "/db", ...P], {
      stdin: "x${MISSING}",
    });
    expect(set.code, set.stderr).toBe(0);
    const r = await cli(["run", "--path", "/db", ...P, "--", ...PRINT_DB_URL]);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("Unresolved reference ${MISSING}");
    expect(r.stderr).toContain("hint: Use --no-expand to skip reference expansion.");
    const del = await cli(["secrets", "delete", "BROKEN", "--path", "/db", "--yes", ...P]);
    expect(del.code, del.stderr).toBe(0);
  });

  it("6. history, get --at-version and rollback", async () => {
    const update = await cli(["secrets", "set", "DB_URL", "--path", "/db", ...P], {
      stdin: "postgres://u:${PASSWORD}@h2/db",
    });
    expect(update.code, update.stderr).toBe(0);
    const history = await cli(["secrets", "history", "DB_URL", "--path", "/db", "--json", ...P]);
    expect(history.code, history.stderr).toBe(0);
    expect((JSON.parse(history.stdout) as { version: number }[]).map((v) => v.version)).toEqual([
      2, 1,
    ]);
    const past = await cli([
      "secrets",
      "get",
      "DB_URL",
      "--at-version",
      "1",
      "--path",
      "/db",
      ...P,
    ]);
    expect(past.code, past.stderr).toBe(0);
    expect(past.stdout).toBe(RAW);
    const rollback = await cli([
      "secrets",
      "rollback",
      "DB_URL",
      "--to",
      "1",
      "--path",
      "/db",
      "--yes",
      ...P,
    ]);
    expect(rollback.code, rollback.stderr).toBe(0);
    expect(rollback.stderr).toContain("Rolled back to v1 (new version v3)");
    const r = await cli(["run", "--path", "/db", ...P, "--", ...PRINT_DB_URL]);
    expect(r.stdout).toBe(EXPANDED);
  });

  it("7. folders delete refuses a non-empty folder without --force", async () => {
    const r = await cli(["folders", "delete", "/db", "--yes", ...P]);
    expect(r.code).toBe(6);
    expect(r.stderr).toContain("hint: Re-run with --force");
    const forced = await cli(["folders", "delete", "/db", "--force", "--yes", ...P]);
    expect(forced.code, forced.stderr).toBe(0);
    const list = await cli(["folders", "list", ...P]);
    expect(list.stdout).toBe("");
  });
});
