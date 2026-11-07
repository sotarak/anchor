import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseDotenv } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cliRunner } from "./cli-process";
import { startAnchor } from "./harness";
import { tmpDirOutsideTest } from "./tmp";

const PASSWORD = "e2e owner passphrase";
const DB_URL = "postgres://u:p@h/db";

let anchor: Awaited<ReturnType<typeof startAnchor>>;
let home: string;
let cwd: string;

const cli = cliRunner(() => ({ home, cwd, apiUrl: anchor.url }));

const credentialsFile = () => join(home, ".config", "anchor", "credentials.json");

async function storedToken(): Promise<string> {
  const data = JSON.parse(await readFile(credentialsFile(), "utf8")) as {
    credentials: Record<string, { token: string }>;
  };
  const token = data.credentials[anchor.url]?.token;
  if (!token) throw new Error("no stored session");
  return token;
}

beforeAll(async () => {
  anchor = await startAnchor();
  home = await tmpDirOutsideTest();
  cwd = join(home, "work");
  await mkdir(cwd);
  const res = await fetch(`${anchor.url}/api/v1/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "owner@example.com",
      name: "Owner",
      password: PASSWORD,
    }),
  });
  expect(res.status).toBe(201);
});

afterAll(async () => {
  await anchor?.stop();
});

describe("anchor CLI against a local Worker", () => {
  let tokenId = "";
  let ciToken = "";

  it("1. login --password-stdin stores a 0600 credential and never echoes the password", async () => {
    const r = await cli(["login", "--email", "owner@example.com", "--password-stdin"], {
      stdin: `${PASSWORD}\n`,
    });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe(`Logged in to ${anchor.url} as owner@example.com\n`);
    expect(r.stdout + r.stderr).not.toContain(PASSWORD);
    if (process.platform !== "win32") {
      expect((await stat(credentialsFile())).mode & 0o777).toBe(0o600);
    }
  });

  it("2. whoami --json reports a user", async () => {
    const r = await cli(["whoami", "--json"]);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ apiUrl: anchor.url, type: "user" });
  });

  it("3. projects list is empty; create project demo with the stored token", async () => {
    const r = await cli(["projects", "list", "--json"]);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ projects: [] });
    const res = await fetch(`${anchor.url}/api/v1/projects`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await storedToken()}`,
      },
      body: JSON.stringify({ name: "Demo", slug: "demo" }),
    });
    expect(res.status).toBe(201);
  });

  it("4. init writes .anchor.json", async () => {
    const r = await cli(["init", "--project", "demo", "--env", "dev"]);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(await readFile(join(cwd, ".anchor.json"), "utf8"))).toEqual({
      version: 1,
      project: "demo",
      defaultEnv: "dev",
    });
  });

  it("5. secrets set reads the value from stdin", async () => {
    const r = await cli(["secrets", "set", "DB_URL"], { stdin: `${DB_URL}\n` });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe("Created DB_URL (v1) in dev:/\n");
  });

  it("6. secrets get (piped) prints exactly the value", async () => {
    const r = await cli(["secrets", "get", "DB_URL"]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe(DB_URL);
  });

  it("7. secrets list --json has no values", async () => {
    const r = await cli(["secrets", "list", "--json"]);
    expect(r.code, r.stderr).toBe(0);
    const { secrets } = JSON.parse(r.stdout) as { secrets: Record<string, unknown>[] };
    expect(secrets.map((s) => s.key)).toEqual(["DB_URL"]);
    expect(secrets[0]).not.toHaveProperty("value");
  });

  it("8. run injects the secret into the child", async () => {
    const r = await cli(["run", "--", "node", "-e", "process.stdout.write(process.env.DB_URL)"]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe(DB_URL);
  });

  it("9. run exits with the child's code", async () => {
    const r = await cli(["run", "--", "node", "-e", "process.exit(7)"]);
    expect(r.code).toBe(7);
  });

  it("10. export --output writes a 0600 dotenv file that parses back", async () => {
    const r = await cli(["export", "--format", "dotenv", "--output", ".env.local", "--yes"]);
    expect(r.code, r.stderr).toBe(0);
    const file = join(cwd, ".env.local");
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(parseDotenv(await readFile(file, "utf8"))).toEqual({ DB_URL });
  });

  it("11. tokens create --json returns the token once", async () => {
    const r = await cli([
      "tokens",
      "create",
      "--name",
      "ci",
      "--scope",
      "dev",
      "--permission",
      "read",
      "--json",
    ]);
    expect(r.code, r.stderr).toBe(0);
    const body = JSON.parse(r.stdout) as { serviceToken: { id: string }; token: string };
    expect(body.token).toMatch(/^anc_st_/);
    tokenId = body.serviceToken.id;
    ciToken = body.token;
  });

  it("12. ANCHOR_TOKEN can read but not write", async () => {
    const get = await cli(["secrets", "get", "DB_URL"], { env: { ANCHOR_TOKEN: ciToken } });
    expect(get.code, get.stderr).toBe(0);
    expect(get.stdout).toBe(DB_URL);
    const set = await cli(["secrets", "set", "X"], { stdin: "y", env: { ANCHOR_TOKEN: ciToken } });
    expect(set.code, set.stderr).toBe(4);
  });

  it("13. ANCHOR_TOKEN is refused when the API URL comes only from .anchor.json", async () => {
    const pf = join(cwd, ".anchor.json");
    const original = await readFile(pf, "utf8");
    await writeFile(pf, JSON.stringify({ ...JSON.parse(original), apiUrl: anchor.url }));
    try {
      const r = await cli(["secrets", "get", "DB_URL"], {
        env: { ANCHOR_TOKEN: ciToken, ANCHOR_API_URL: undefined },
      });
      expect(r.code).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("ANCHOR_TOKEN is only sent to an API URL from --api-url");
    } finally {
      await writeFile(pf, original);
    }
  });

  it("14. a revoked token is rejected with exit 3", async () => {
    const revoke = await cli(["tokens", "revoke", tokenId, "--yes"]);
    expect(revoke.code, revoke.stderr).toBe(0);
    const r = await cli(["secrets", "get", "DB_URL"], { env: { ANCHOR_TOKEN: ciToken } });
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("ANCHOR_TOKEN was rejected");
  });

  it("15. secrets delete needs --yes without a terminal", async () => {
    const refused = await cli(["secrets", "delete", "DB_URL"]);
    expect(refused.code).toBe(2);
    expect((await cli(["secrets", "get", "DB_URL"])).stdout).toBe(DB_URL);
    const done = await cli(["secrets", "delete", "DB_URL", "--yes"]);
    expect(done.code, done.stderr).toBe(0);
    expect((await cli(["secrets", "get", "DB_URL"])).code).toBe(5);
  });

  it("16. logout revokes the session; whoami then exits 3", async () => {
    const token = await storedToken();
    const out = await cli(["logout"]);
    expect(out.code, out.stderr).toBe(0);
    expect((await cli(["whoami"])).code).toBe(3);
    const res = await fetch(`${anchor.url}/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });
});
