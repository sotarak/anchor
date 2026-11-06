import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LoginResponse, ServiceTokenDto, UserDto } from "@anchor/shared";
import { describe, expect, it } from "vitest";
import type { ApiClient } from "#src/api/client";
import {
  apiError,
  createTestIo,
  fakeApi,
  fakePrompts,
  memoryStore,
  runCli,
  type TestIo,
  tmpDir,
} from "#test/support";

const API = "https://anchor.example";
const PASSWORD = "PASSWORDCANARY-1234";
const TOKEN = "anc_s_TOKENCANARY";
const user: UserDto = { id: "u1", email: "dev@example.com", name: "Dev", role: "admin" };
const expiresAt = Date.now() + 30 * 86_400_000;
const loginOk = async (): Promise<LoginResponse> => ({ user, token: TOKEN, expiresAt });

async function env(opts: { env?: Record<string, string>; tty?: boolean; stdin?: string } = {}) {
  const dir = await tmpDir();
  const xdg = join(dir, "xdg");
  const io = createTestIo({
    cwd: dir,
    env: { XDG_CONFIG_HOME: xdg, ...opts.env },
    stdinIsTTY: opts.tty ?? false,
    stdin: opts.stdin,
  });
  return { dir, xdg, io };
}

function run(io: TestIo, args: string[], api: Partial<ApiClient>, extra: object = {}) {
  const fake = fakeApi(api);
  const mem = memoryStore();
  const prompts = fakePrompts();
  return {
    fake,
    mem,
    prompts,
    code: runCli(args, {
      io,
      createApi: fake.factory,
      selectStore: mem.selectStore,
      prompts: prompts.prompts,
      ...extra,
    }),
  };
}

describe("anchor login", () => {
  it("login --password-stdin stores credential and prints no token on stdout or stderr", async () => {
    const { io, xdg } = await env({ stdin: `${PASSWORD}\n` });
    const r = run(io, ["login", "--api-url", API, "--email", user.email, "--password-stdin"], {
      login: loginOk,
    });
    expect(await r.code).toBe(0);
    expect(r.fake.called("login")[0]?.args).toEqual([user.email, PASSWORD]);
    expect(r.fake.clients[0]).toEqual({ baseUrl: API, token: undefined });
    expect(r.mem.items.get(API)).toEqual({
      apiUrl: API,
      token: TOKEN,
      email: user.email,
      expiresAt,
    });
    expect(io.out()).toBe(`Logged in to ${API} as ${user.email}\n`);
    expect(io.err()).toContain(`Logging in to ${API}`);
    for (const text of [io.out(), io.err()]) {
      expect(text).not.toContain("TOKENCANARY");
      expect(text).not.toContain("PASSWORDCANARY");
    }
    // The first login records the API URL in the user config.
    expect(JSON.parse(await readFile(join(xdg, "anchor", "config.json"), "utf8"))).toEqual({
      apiUrl: API,
    });
  });

  it("strips exactly one trailing CRLF from --password-stdin", async () => {
    const { io } = await env({ stdin: `${PASSWORD}\r\n\r\n` });
    const r = run(io, ["login", "--api-url", API, "--email", user.email, "--password-stdin"], {
      login: loginOk,
    });
    expect(await r.code).toBe(0);
    expect(r.fake.called("login")[0]?.args[1]).toBe(`${PASSWORD}\r\n`);
  });

  it("--json prints the documented shape without the token", async () => {
    const { io } = await env({ stdin: PASSWORD });
    const r = run(
      io,
      ["login", "--json", "--api-url", API, "--email", user.email, "--password-stdin"],
      { login: loginOk },
    );
    expect(await r.code).toBe(0);
    expect(JSON.parse(io.out())).toEqual({ apiUrl: API, user, expiresAt, credentialStore: "file" });
    expect(io.out()).not.toContain("TOKENCANARY");
  });

  it("login without TTY and without --password-stdin exits 2 and never calls the API", async () => {
    const { io } = await env();
    const r = run(io, ["login", "--api-url", API, "--email", user.email], { login: loginOk });
    expect(await r.code).toBe(2);
    expect(r.fake.calls).toEqual([]);
    expect(io.err()).toContain("error: anchor login needs a terminal");
    expect(io.err()).toContain("hint: Use --password-stdin, or set ANCHOR_TOKEN in CI");
  });

  it("login without --email in non-TTY exits 2", async () => {
    const { io } = await env({ stdin: PASSWORD });
    const r = run(io, ["login", "--api-url", API, "--password-stdin"], { login: loginOk });
    expect(await r.code).toBe(2);
    expect(r.fake.calls).toEqual([]);
  });

  it("login to http://example.com exits 2 before prompting for a password", async () => {
    const { io } = await env({ tty: true });
    const r = run(io, ["login", "--api-url", "http://example.com"], { login: loginOk });
    expect(await r.code).toBe(2);
    expect(r.prompts.calls).toEqual([]);
    expect(r.fake.calls).toEqual([]);
    expect(io.err()).toContain("Refusing to use insecure http:// API URL http://example.com");

    // A URL typed at the prompt is checked before the password prompt too.
    const typed = await env({ tty: true });
    const prompts = fakePrompts({ input: ["http://example.com"] });
    const r2 = run(typed.io, ["login"], { login: loginOk }, { prompts: prompts.prompts });
    expect(await r2.code).toBe(2);
    expect(prompts.calls.map((c) => c.kind)).toEqual(["input"]);
  });

  it("interactive login prompts for API URL, email and hidden password", async () => {
    const { io } = await env({ tty: true });
    const prompts = fakePrompts({ input: [`${API}/`, user.email], password: [PASSWORD] });
    const r = run(io, ["login"], { login: loginOk }, { prompts: prompts.prompts });
    expect(await r.code).toBe(0);
    expect(prompts.calls.map((c) => [c.kind, c.message])).toEqual([
      ["input", "API URL"],
      ["input", "Email"],
      ["password", "Password"],
    ]);
    expect(r.fake.clients[0]?.baseUrl).toBe(API);
  });

  async function projectPointsTo(dir: string, xdg: string, userApiUrl?: string) {
    await writeFile(
      join(dir, ".anchor.json"),
      JSON.stringify({ version: 1, project: "app", apiUrl: "https://other.example" }),
    );
    if (userApiUrl) {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(join(xdg, "anchor"), { recursive: true });
      await writeFile(join(xdg, "anchor", "config.json"), JSON.stringify({ apiUrl: userApiUrl }));
    }
  }

  it("non-TTY login to an apiUrl that comes only from .anchor.json exits 2 without sending the password", async () => {
    for (const userApiUrl of [API, undefined]) {
      const { io, dir, xdg } = await env({ stdin: PASSWORD });
      await projectPointsTo(dir, xdg, userApiUrl);
      const r = run(io, ["login", "--email", user.email, "--password-stdin"], { login: loginOk });
      expect(await r.code).toBe(2);
      expect(r.fake.called("login")).toEqual([]);
      expect(io.err()).toContain(
        "error: Not logging in to https://other.example: it comes only from .anchor.json",
      );
      expect(io.err()).toContain(
        "hint: Pass --api-url https://other.example (or --yes) if you trust this server",
      );
      expect(io.err()).not.toContain(PASSWORD);
    }
  });

  it("with --yes it warns, names the target, logs in, and never saves a project-sourced URL to user config", async () => {
    const { io, dir, xdg } = await env({ stdin: PASSWORD });
    await projectPointsTo(dir, xdg);
    const r = run(io, ["login", "--quiet", "--yes", "--email", user.email, "--password-stdin"], {
      login: loginOk,
    });
    expect(await r.code).toBe(0);
    expect(io.err()).toContain(
      "warning: .anchor.json points to https://other.example, which differs from your configured (none)",
    );
    expect(io.err()).toContain("Logging in to https://other.example");
    expect(r.fake.clients[0]?.baseUrl).toBe("https://other.example");
    const saved = await readFile(join(xdg, "anchor", "config.json"), "utf8").catch(() => "{}");
    expect(JSON.parse(saved).apiUrl).toBeUndefined();
  });

  it("at a terminal it asks before sending the password; 'no' aborts without a login call", async () => {
    for (const answer of [false, true]) {
      const { io, dir, xdg } = await env({ tty: true });
      await projectPointsTo(dir, xdg, API);
      const prompts = fakePrompts({ confirm: [answer], password: [PASSWORD] });
      const r = run(
        io,
        ["login", "--email", user.email],
        { login: loginOk },
        {
          prompts: prompts.prompts,
        },
      );
      expect(await r.code).toBe(answer ? 0 : 1);
      expect(prompts.calls[0]).toEqual({
        kind: "confirm",
        message: "Send your password to https://other.example?",
      });
      expect(r.fake.called("login").length > 0).toBe(answer);
    }
  });

  it("an .anchor.json apiUrl equal to the user config logs in without asking", async () => {
    const { io, dir, xdg } = await env({ stdin: PASSWORD });
    await writeFile(
      join(dir, ".anchor.json"),
      JSON.stringify({ version: 1, project: "app", apiUrl: API }),
    );
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(xdg, "anchor"), { recursive: true });
    await writeFile(join(xdg, "anchor", "config.json"), JSON.stringify({ apiUrl: API }));
    const r = run(io, ["login", "--email", user.email, "--password-stdin"], { login: loginOk });
    expect(await r.code).toBe(0);
    expect(io.err()).not.toContain("warning:");
  });

  it("login invalid credentials -> exit 3 'Invalid email or password'", async () => {
    const { io } = await env({ stdin: PASSWORD });
    const r = run(io, ["login", "--api-url", API, "--email", user.email, "--password-stdin"], {
      login: async () =>
        Promise.reject(apiError(401, "invalid_credentials", "Invalid credentials")),
    });
    expect(await r.code).toBe(3);
    expect(io.err()).toContain("error: Invalid email or password");
    expect(r.mem.items.size).toBe(0);
  });

  it("login rate limited -> exit 1", async () => {
    const { io } = await env({ stdin: PASSWORD });
    const r = run(io, ["login", "--api-url", API, "--email", user.email, "--password-stdin"], {
      login: async () => Promise.reject(apiError(429, "rate_limited", "Too many")),
    });
    expect(await r.code).toBe(1);
    expect(io.err()).toContain("error: Too many failed attempts; try again later");
  });
});

describe("anchor logout", () => {
  const stored = { apiUrl: API, token: TOKEN, email: user.email, expiresAt };

  it("logout revokes server-side then deletes locally; network failure still deletes locally and exits 1", async () => {
    const ok = await env({ env: { ANCHOR_API_URL: API } });
    const fake = fakeApi({ logout: async () => {} });
    const mem = memoryStore([stored]);
    expect(
      await runCli(["logout", "--json"], {
        io: ok.io,
        createApi: fake.factory,
        selectStore: mem.selectStore,
      }),
    ).toBe(0);
    expect(fake.called("logout")).toHaveLength(1);
    expect(fake.clients[0]).toEqual({ baseUrl: API, token: TOKEN });
    expect(mem.items.size).toBe(0);
    expect(JSON.parse(ok.io.out())).toEqual({ loggedOut: true, revoked: true });

    const down = await env({ env: { ANCHOR_API_URL: API } });
    const failing = fakeApi({
      logout: async () =>
        Promise.reject(apiError(0, "network_error", "Could not connect to https://anchor.example")),
    });
    const mem2 = memoryStore([stored]);
    expect(
      await runCli(["logout"], {
        io: down.io,
        createApi: failing.factory,
        selectStore: mem2.selectStore,
      }),
    ).toBe(1);
    expect(mem2.items.size).toBe(0);
    expect(down.io.err()).toContain(
      "error: Removed local credentials but could not revoke the session on the server",
    );
    expect(down.io.err()).toContain(
      `hint: It stays valid until ${new Date(expiresAt).toISOString()}`,
    );
  });

  it("a 401 on logout counts as already revoked", async () => {
    const { io } = await env({ env: { ANCHOR_API_URL: API } });
    const fake = fakeApi({ logout: async () => Promise.reject(apiError(401, "unauthenticated")) });
    const mem = memoryStore([stored]);
    expect(
      await runCli(["logout"], { io, createApi: fake.factory, selectStore: mem.selectStore }),
    ).toBe(0);
    expect(mem.items.size).toBe(0);
    expect(io.err()).toContain(`Logged out of ${API}`);
  });

  it("no stored credential -> 'Not logged in', exit 0; ANCHOR_TOKEN set -> warning", async () => {
    const { io } = await env({ env: { ANCHOR_API_URL: API, ANCHOR_TOKEN: "anc_st_x" } });
    const fake = fakeApi();
    expect(
      await runCli(["logout"], {
        io,
        createApi: fake.factory,
        selectStore: memoryStore().selectStore,
      }),
    ).toBe(0);
    expect(io.err()).toContain(
      "warning: ANCHOR_TOKEN is set; logout only affects stored credentials",
    );
    expect(io.err()).toContain("Not logged in");
    expect(fake.calls).toEqual([]);
  });
});

describe("anchor whoami", () => {
  const stored = { apiUrl: API, token: TOKEN, email: user.email, expiresAt };
  const serviceToken: ServiceTokenDto = {
    id: "t1",
    name: "ci",
    tokenPrefix: "anc_st_abcde",
    projectSlug: "app",
    permission: "read",
    scopes: [{ environment: "prod", path: "/" }],
    createdAt: 1,
    expiresAt: 2,
    lastUsedAt: null,
    revokedAt: null,
  };

  it("whoami renders user and service-token principals; --json shapes match the contract", async () => {
    const human = await env({ env: { ANCHOR_API_URL: API } });
    const mem = memoryStore([stored]);
    const asUser = fakeApi({ me: async () => ({ user }) });
    expect(
      await runCli(["whoami"], {
        io: human.io,
        createApi: asUser.factory,
        selectStore: mem.selectStore,
      }),
    ).toBe(0);
    expect(human.io.out()).toBe(`dev@example.com (admin) at ${API}\n`);

    const json = await env({ env: { ANCHOR_API_URL: API } });
    expect(
      await runCli(["whoami", "--json"], {
        io: json.io,
        createApi: asUser.factory,
        selectStore: mem.selectStore,
      }),
    ).toBe(0);
    expect(JSON.parse(json.io.out())).toEqual({ apiUrl: API, type: "user", user });

    const asToken = fakeApi({ me: async () => ({ serviceToken }) });
    const tok = await env({ env: { ANCHOR_API_URL: API, ANCHOR_TOKEN: "anc_st_x" } });
    expect(
      await runCli(["whoami"], {
        io: tok.io,
        createApi: asToken.factory,
        selectStore: mem.selectStore,
      }),
    ).toBe(0);
    expect(tok.io.out()).toBe(`service token ci (read) for project app at ${API}\n`);
    expect(asToken.clients[0]?.token).toBe("anc_st_x");

    const tokJson = await env({ env: { ANCHOR_API_URL: API, ANCHOR_TOKEN: "anc_st_x" } });
    expect(
      await runCli(["--json", "whoami"], {
        io: tokJson.io,
        createApi: asToken.factory,
        selectStore: mem.selectStore,
      }),
    ).toBe(0);
    expect(JSON.parse(tokJson.io.out())).toEqual({
      apiUrl: API,
      type: "service_token",
      serviceToken,
    });
  });

  it("revoked session on whoami -> exit 3 'Your session has expired or was revoked' with login hint", async () => {
    const { io } = await env({ env: { ANCHOR_API_URL: API } });
    const fake = fakeApi({ me: async () => Promise.reject(apiError(401, "unauthenticated")) });
    expect(
      await runCli(["whoami"], {
        io,
        createApi: fake.factory,
        selectStore: memoryStore([stored]).selectStore,
      }),
    ).toBe(3);
    expect(io.err()).toBe(
      "error: Your session has expired or was revoked\nhint: Run 'anchor login'\n",
    );
    expect(io.out()).toBe("");
  });

  it("not logged in -> exit 3", async () => {
    const { io } = await env({ env: { ANCHOR_API_URL: API } });
    expect(
      await runCli(["whoami"], {
        io,
        createApi: fakeApi().factory,
        selectStore: memoryStore().selectStore,
      }),
    ).toBe(3);
  });
});
