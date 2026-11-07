import { env } from "cloudflare:workers";
import type { CliLoginStartDto, LoginResponse } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { decideCliLogin } from "#src/auth/cli-login";
import { sha256Hex } from "#src/lib/random";
import { api, auditRows, createUserWithSession, json, jsonInit, resetDb } from "#test/support";

const db = env.DB;
const UA = "anchor-cli/0.4.0 (darwin)";
const start = (clientName?: string) =>
  api("/api/v1/auth/cli/start", {
    ...jsonInit("POST", clientName === undefined ? {} : { clientName }),
    headers: { "content-type": "application/json", "user-agent": UA },
  });
const poll = (deviceCode: string) =>
  api("/api/v1/auth/cli/token", jsonInit("POST", { deviceCode }));
const errorOf = async (res: Response) =>
  (await json<{ error: { code: string; message: string } }>(res)).error;
/** Lets the next poll through the interval check. */
const allowPoll = () => db.prepare("UPDATE cli_logins SET last_polled_at = NULL").run();
const started = async () => json<CliLoginStartDto>(await start("me@laptop"));

async function insertPending(n: number, expiresAt: number) {
  const statements = [];
  for (let i = 0; i < n; i++) {
    const letters = "BCDFGHJKLMNPQRSTVWXZ";
    const a = letters[i % 20];
    const b = letters[Math.floor(i / 20)];
    statements.push(
      db
        .prepare(
          "INSERT INTO cli_logins (id, user_code, status, created_at, expires_at) VALUES (?, ?, 'pending', 0, ?)",
        )
        .bind(`row${i}`, `${a}${b}BB-BBBB`, expiresAt),
    );
  }
  await db.batch(statements);
}

beforeEach(resetDb);

describe("CLI login: start and token exchange", () => {
  it("start returns codes and URLs", async () => {
    const res = await start("me@laptop");
    expect(res.status).toBe(200);
    const body = await json<CliLoginStartDto>(res);
    expect(body.verificationUri).toBe("http://anchor.test/cli/login");
    expect(body.verificationUriComplete).toBe(`${body.verificationUri}?code=${body.userCode}`);
    expect(body.interval).toBe(5);
    expect(Math.abs(body.expiresAt - Date.now() - 600_000)).toBeLessThan(5_000);
    expect(body.deviceCode.startsWith("anc_dc_")).toBe(true);
    const row = await db.prepare("SELECT * FROM cli_logins").first<Record<string, unknown>>();
    expect(row?.id).toBe(await sha256Hex(body.deviceCode));
    expect(row).toMatchObject({
      status: "pending",
      user_code: body.userCode,
      client_name: "me@laptop",
      user_agent: UA,
    });
    expect(Object.values(row ?? {})).not.toContain(body.deviceCode);
  });

  it("polling a pending request returns 202", async () => {
    const { deviceCode } = await started();
    const res = await poll(deviceCode);
    expect(res.status).toBe(202);
    expect(await json(res)).toEqual({ status: "pending" });
  });

  it("polling sooner than the interval returns 429", async () => {
    const { deviceCode } = await started();
    expect((await poll(deviceCode)).status).toBe(202);
    const res = await poll(deviceCode);
    expect(res.status).toBe(429);
    expect((await errorOf(res)).code).toBe("rate_limited");
  });

  it("an unknown device code returns 404", async () => {
    const res = await poll("anc_dc_unknown");
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toMatchObject({
      code: "not_found",
      message: "This login request expired or does not exist",
    });
  });

  it("an expired request returns 404", async () => {
    const { deviceCode } = await started();
    await db
      .prepare("UPDATE cli_logins SET expires_at = ?")
      .bind(Date.now() - 1)
      .run();
    expect((await poll(deviceCode)).status).toBe(404);
  });

  it("an approved request returns a working cli session once", async () => {
    const { userId } = await createUserWithSession({ role: "member", kind: "web" });
    const { deviceCode, userCode } = await started();
    expect(await decideCliLogin(db, userCode, "approved", userId, Date.now())).toBe(true);
    const res = await poll(deviceCode);
    expect(res.status).toBe(200);
    const login = await json<LoginResponse>(res);
    expect(login.user.id).toBe(userId);
    expect(login.token).toBeTruthy();
    const me = await api("/api/v1/auth/me", {
      headers: { authorization: `Bearer ${login.token}` },
    });
    expect(me.status).toBe(200);
    const session = await db
      .prepare("SELECT kind, user_agent FROM sessions WHERE id = ?")
      .bind(await sha256Hex(login.token ?? ""))
      .first();
    expect(session).toEqual({ kind: "cli", user_agent: UA });
    await allowPoll();
    expect((await poll(deviceCode)).status).toBe(404);
    const [event] = await auditRows("auth.login");
    expect(JSON.parse(event?.metadata ?? "null")).toEqual({ client: "cli", method: "browser" });
  });

  it("a denied request returns 403", async () => {
    const { userId } = await createUserWithSession({ role: "member", kind: "web" });
    const { deviceCode, userCode } = await started();
    await decideCliLogin(db, userCode, "denied", userId, Date.now());
    const res = await poll(deviceCode);
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({
      code: "forbidden",
      message: "This login was denied",
    });
  });

  it("two polls race after approval", async () => {
    const { userId } = await createUserWithSession({ role: "member", kind: "web" });
    const { deviceCode, userCode } = await started();
    await decideCliLogin(db, userCode, "approved", userId, Date.now());
    const statuses = (await Promise.all([poll(deviceCode), poll(deviceCode)]))
      .map((r) => r.status)
      .sort();
    // The losing poll is either refused by the interval check (429) or finds the row consumed
    // (404); never a second session.
    expect(statuses[0]).toBe(200);
    expect([404, 429]).toContain(statuses[1]);
    const n = await db
      .prepare("SELECT COUNT(*) AS n FROM sessions WHERE kind = 'cli'")
      .first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it("start refuses past 50 pending requests", async () => {
    await insertPending(50, Date.now() + 60_000);
    const res = await start();
    expect(res.status).toBe(429);
    expect(await errorOf(res)).toMatchObject({
      code: "rate_limited",
      message: "Too many pending CLI logins, try again later",
    });
  });

  it("expired requests do not count toward the cap", async () => {
    await insertPending(50, Date.now() - 1);
    expect((await start()).status).toBe(200);
  });

  it("start and polls write no audit rows", async () => {
    const { deviceCode } = await started();
    await poll(deviceCode);
    await poll("anc_dc_unknown");
    expect(await auditRows()).toEqual([]);
  });
});
