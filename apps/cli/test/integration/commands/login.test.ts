import { readFile, writeFile } from "node:fs/promises";
import { hostname, userInfo } from "node:os";
import { join } from "node:path";
import type { CliLoginStartDto, LoginResponse, ServiceTokenDto, UserDto } from "@anchor/shared";
import { describe, expect, it } from "vitest";
import type { ApiClient } from "#src/api/client";
import { ApiRequestError } from "#src/api/http";
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
    expect(JSON.parse(io.out())).toEqual({
      apiUrl: API,
      user,
      expiresAt,
      credentialStore: "file",
      defaultApiUrl: API,
    });
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
    const r = run(
      io,
      ["login", "--with-password"],
      { login: loginOk },
      { prompts: prompts.prompts },
    );
    expect(await r.code).toBe(0);
    expect(prompts.calls.map((c) => [c.kind, c.message])).toEqual([
      ["input", "API URL"],
      ["input", "Email"],
      ["password", "Password"],
    ]);
    expect(r.fake.clients[0]?.baseUrl).toBe(API);
  });

  const OLD = "https://old.example";
  const NEW = "https://new.example";
  async function defaultServer(xdg: string, apiUrl: string) {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(xdg, "anchor"), { recursive: true });
    await writeFile(join(xdg, "anchor", "config.json"), JSON.stringify({ apiUrl }));
  }
  const savedDefault = async (xdg: string) =>
    JSON.parse(await readFile(join(xdg, "anchor", "config.json"), "utf8"));

  it("--api-url replaces a different default and says so", async () => {
    const { io, xdg } = await env({ stdin: PASSWORD });
    await defaultServer(xdg, OLD);
    const r = run(io, ["login", "--api-url", NEW, "--email", user.email, "--password-stdin"], {
      login: loginOk,
    });
    expect(await r.code).toBe(0);
    expect(await savedDefault(xdg)).toEqual({ apiUrl: NEW });
    expect(io.err()).toContain(`Default server changed from ${OLD} to ${NEW}`);
  });

  it("--api-url equal to the default after normalization changes nothing", async () => {
    const { io, xdg } = await env({ stdin: PASSWORD });
    await defaultServer(xdg, NEW);
    const before = await readFile(join(xdg, "anchor", "config.json"), "utf8");
    const r = run(
      io,
      [
        "login",
        "--api-url",
        "https://NEW.example/some/path/",
        "--email",
        user.email,
        "--password-stdin",
      ],
      { login: loginOk },
    );
    expect(await r.code).toBe(0);
    expect(io.err()).not.toContain("Default server changed");
    expect(await readFile(join(xdg, "anchor", "config.json"), "utf8")).toBe(before);
  });

  it("ANCHOR_API_URL does not replace an existing default", async () => {
    const { io, xdg } = await env({
      stdin: PASSWORD,
      env: { ANCHOR_API_URL: "https://env.example" },
    });
    await defaultServer(xdg, OLD);
    const r = run(io, ["login", "--email", user.email, "--password-stdin"], { login: loginOk });
    expect(await r.code).toBe(0);
    expect(r.fake.clients[0]?.baseUrl).toBe("https://env.example");
    expect(await savedDefault(xdg)).toEqual({ apiUrl: OLD });
    expect(io.err()).not.toContain("Default server changed");
  });

  it("--json reports defaultApiUrl after a replacing login", async () => {
    const { io, xdg } = await env({ stdin: PASSWORD });
    await defaultServer(xdg, OLD);
    const r = run(
      io,
      ["login", "--json", "--api-url", NEW, "--email", user.email, "--password-stdin"],
      { login: loginOk },
    );
    expect(await r.code).toBe(0);
    expect(JSON.parse(io.out()).defaultApiUrl).toBe(NEW);
  });

  it("--json reports a null defaultApiUrl when only .anchor.json named the server", async () => {
    const { io, dir, xdg } = await env({ stdin: PASSWORD });
    await projectPointsTo(dir, xdg);
    const r = run(io, ["login", "--json", "--yes", "--email", user.email, "--password-stdin"], {
      login: loginOk,
    });
    expect(await r.code).toBe(0);
    expect(JSON.parse(io.out()).defaultApiUrl).toBeNull();
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

describe("anchor login (browser)", () => {
  const URL_COMPLETE = `${API}/cli/login?code=WDJB-MJHT`;
  const started: CliLoginStartDto = {
    deviceCode: "anc_dc_DEVICECANARY",
    userCode: "WDJB-MJHT",
    verificationUri: `${API}/cli/login`,
    verificationUriComplete: URL_COMPLETE,
    expiresAt: Date.now() + 600_000,
    interval: 5,
  };
  type Poll = "pending" | "approved" | Error;
  function browserApi(polls: Poll[], start: () => Promise<CliLoginStartDto> = async () => started) {
    const queue = [...polls];
    return {
      cliLoginStart: start,
      cliLoginToken: async () => {
        const next = queue.shift();
        if (next instanceof Error) throw next;
        if (next === "approved") return { status: "approved" as const, login: await loginOk() };
        return { status: "pending" as const };
      },
    };
  }
  function deps() {
    const sleeps: number[] = [];
    const opened: string[] = [];
    let openResult = true;
    return {
      sleeps,
      opened,
      failOpen: () => {
        openResult = false;
      },
      extra: {
        sleep: async (ms: number) => {
          sleeps.push(ms);
        },
        openUrl: async (url: string) => {
          opened.push(url);
          return openResult;
        },
      },
    };
  }

  it("login with no flags uses the browser flow", async () => {
    const { io } = await env();
    const d = deps();
    const r = run(
      io,
      ["login", "--api-url", API],
      browserApi(["pending", "pending", "approved"]),
      d.extra,
    );
    expect(await r.code).toBe(0);
    expect(io.err()).toContain(`Open ${URL_COMPLETE} and confirm the code WDJB-MJHT`);
    expect(io.err()).toContain("Waiting for approval…");
    expect(d.sleeps).toEqual([5000, 5000, 5000]);
    expect(r.fake.called("cliLoginToken").map((c) => c.args)).toEqual([
      ["anc_dc_DEVICECANARY"],
      ["anc_dc_DEVICECANARY"],
      ["anc_dc_DEVICECANARY"],
    ]);
    expect(r.mem.items.get(API)).toEqual({
      apiUrl: API,
      token: TOKEN,
      email: user.email,
      expiresAt,
    });
    expect(io.out()).toBe(`Logged in to ${API} as ${user.email}\n`);
    expect(r.prompts.calls).toEqual([]);
    for (const text of [io.out(), io.err()]) {
      expect(text).not.toContain("TOKENCANARY");
      expect(text).not.toContain("DEVICECANARY");
    }
  });

  it("browser login with --api-url replaces the default", async () => {
    const { io, xdg } = await env();
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(xdg, "anchor"), { recursive: true });
    await writeFile(
      join(xdg, "anchor", "config.json"),
      JSON.stringify({ apiUrl: "https://old.example" }),
    );
    const r = run(io, ["login", "--api-url", API], browserApi(["approved"]), deps().extra);
    expect(await r.code).toBe(0);
    expect(JSON.parse(await readFile(join(xdg, "anchor", "config.json"), "utf8"))).toEqual({
      apiUrl: API,
    });
    expect(io.err()).toContain(`Default server changed from https://old.example to ${API}`);
  });

  it("sends <user>@<host> as the client name", async () => {
    const { io } = await env();
    const r = run(io, ["login", "--api-url", API], browserApi(["approved"]), deps().extra);
    expect(await r.code).toBe(0);
    const expected = `${userInfo().username}@${hostname()}`.slice(0, 100);
    expect(r.fake.called("cliLoginStart")[0]?.args).toEqual([{ clientName: expected }]);
  });

  it("opens the browser only in a TTY", async () => {
    const tty = await env({ tty: true });
    const a = deps();
    const r1 = run(tty.io, ["login", "--api-url", API], browserApi(["approved"]), a.extra);
    expect(await r1.code).toBe(0);
    expect(a.opened).toEqual([URL_COMPLETE]);

    const noBrowser = await env({ tty: true });
    const b = deps();
    const r2 = run(
      noBrowser.io,
      ["login", "--api-url", API, "--no-browser"],
      browserApi(["approved"]),
      b.extra,
    );
    expect(await r2.code).toBe(0);
    expect(b.opened).toEqual([]);

    const piped = await env();
    const c = deps();
    const r3 = run(piped.io, ["login", "--api-url", API], browserApi(["approved"]), c.extra);
    expect(await r3.code).toBe(0);
    expect(c.opened).toEqual([]);
  });

  it("a failed browser open still prints the URL and polls", async () => {
    const { io } = await env({ tty: true });
    const d = deps();
    d.failOpen();
    const r = run(io, ["login", "--api-url", API], browserApi(["pending", "approved"]), d.extra);
    expect(await r.code).toBe(0);
    expect(io.err()).toContain(`Open ${URL_COMPLETE} and confirm the code WDJB-MJHT`);
    expect(d.opened).toEqual([URL_COMPLETE]);
  });

  it("429 slows polling down", async () => {
    const { io } = await env();
    const d = deps();
    const polls: Poll[] = [apiError(429, "rate_limited"), "pending", "approved"];
    const r = run(io, ["login", "--api-url", API], browserApi(polls), d.extra);
    expect(await r.code).toBe(0);
    expect(d.sleeps).toEqual([5000, 10000, 10000]);
  });

  it("denied and expired requests store nothing", async () => {
    const denied = await env();
    const r1 = run(
      denied.io,
      ["login", "--api-url", API],
      browserApi([apiError(403, "forbidden", "This login was denied")]),
      deps().extra,
    );
    expect(await r1.code).toBe(3);
    expect(denied.io.err()).toContain("Login was denied in the browser");
    expect(r1.mem.items.size).toBe(0);

    const expired = await env();
    const r2 = run(
      expired.io,
      ["login", "--api-url", API],
      browserApi(["pending", apiError(404, "not_found")]),
      deps().extra,
    );
    expect(await r2.code).toBe(3);
    expect(expired.io.err()).toContain("Login request expired; run anchor login again");
    expect(r2.mem.items.size).toBe(0);
  });

  it("opens a URL built from the API URL and the code, never the server's URL", async () => {
    const { io } = await env();
    const d = deps();
    const hostile = {
      ...started,
      verificationUriComplete: "https://evil.example/cli/login&calc.exe",
    };
    const r = run(
      io,
      ["login", "--api-url", API],
      browserApi(["approved"], async () => hostile),
      d.extra,
    );
    expect(await r.code).toBe(0);
    expect(io.err()).toContain(`Open ${URL_COMPLETE} and confirm the code WDJB-MJHT`);
    expect(io.err()).not.toContain("evil.example");
  });

  it("a malformed code from the server stops before opening anything", async () => {
    const { io } = await env();
    const d = deps();
    const r = run(
      io,
      ["login", "--api-url", API],
      browserApi(["approved"], async () => ({ ...started, userCode: "WDJB&calc" })),
      d.extra,
    );
    expect(await r.code).toBe(1);
    expect(io.err()).toContain("error: The server returned an invalid login code");
    expect(d.opened).toEqual([]);
    expect(r.fake.called("cliLoginToken")).toEqual([]);
  });

  it("a local clock ahead of the server does not expire the request", async () => {
    const { io } = await env();
    const r = run(
      io,
      ["login", "--api-url", API],
      browserApi(["pending", "approved"], async () => ({
        ...started,
        expiresAt: Date.now() - 60_000,
      })),
      deps().extra,
    );
    expect(await r.code).toBe(0);
    expect(r.mem.items.get(API)).toMatchObject({ token: TOKEN });
  });

  it("too many pending logins points to --with-password", async () => {
    const { io } = await env();
    const r = run(
      io,
      ["login", "--api-url", API],
      browserApi([], async () => {
        throw apiError(429, "rate_limited", "Too many pending CLI logins, try again later");
      }),
      deps().extra,
    );
    expect(await r.code).toBe(1);
    expect(io.err()).toContain("error: Too many pending CLI logins, try again later");
    expect(io.err()).toContain(
      "hint: Try again in a few minutes, or use anchor login --with-password",
    );
  });

  it("an old server without browser login points to --with-password", async () => {
    const { io } = await env();
    const r = run(
      io,
      ["login", "--api-url", API],
      browserApi([], async () => {
        throw apiError(404, "not_found", "Not found");
      }),
      deps().extra,
    );
    expect(await r.code).toBe(1);
    expect(io.err()).toContain(
      "This server does not support browser login; use anchor login --with-password",
    );
  });

  it("a server that is not Anchor says so instead of blaming browser login", async () => {
    const { io, xdg } = await env();
    const message = `${API} did not answer as an Anchor server (HTTP 404)`;
    const r = run(
      io,
      ["login", "--api-url", API],
      browserApi([], async () => {
        throw new ApiRequestError(404, "internal", message);
      }),
      deps().extra,
    );
    expect(await r.code).toBe(1);
    expect(io.err()).toContain(`error: ${message}`);
    expect(io.err()).toContain("hint: Check the server URL");
    expect(io.err()).not.toContain("does not support browser login");
    await expect(readFile(join(xdg, "anchor", "config.json"), "utf8")).rejects.toThrow();
  });

  it("--with-password, --email or --password-stdin select the password flow", async () => {
    for (const flags of [
      ["--with-password", "--email", user.email, "--password-stdin"],
      ["--email", user.email, "--password-stdin"],
    ]) {
      const { io } = await env({ stdin: PASSWORD });
      const r = run(io, ["login", "--api-url", API, ...flags], { login: loginOk }, deps().extra);
      expect(await r.code).toBe(0);
      expect(r.fake.called("cliLoginStart")).toEqual([]);
    }
  });

  it("an .anchor.json API URL asks 'Log in to <url>?' in browser mode", async () => {
    const tty = await env({ tty: true });
    await writeFile(
      join(tty.dir, ".anchor.json"),
      JSON.stringify({ version: 1, project: "app", apiUrl: "https://other.example" }),
    );
    const prompts = fakePrompts({ confirm: [false] });
    const r = run(tty.io, ["login"], browserApi(["approved"]), {
      ...deps().extra,
      prompts: prompts.prompts,
    });
    expect(await r.code).toBe(1);
    expect(prompts.calls.map((c) => c.message)).toEqual(["Log in to https://other.example?"]);
    expect(r.fake.calls).toEqual([]);

    const piped = await env();
    await writeFile(
      join(piped.dir, ".anchor.json"),
      JSON.stringify({ version: 1, project: "app", apiUrl: "https://other.example" }),
    );
    const r2 = run(piped.io, ["login"], browserApi(["approved"]), deps().extra);
    expect(await r2.code).toBe(2);
    expect(r2.fake.calls).toEqual([]);
  });
});
