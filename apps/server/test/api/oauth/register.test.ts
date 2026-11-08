import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, json, resetDb } from "#test/support";

beforeEach(resetDb);

const register = (body: unknown, ip = "9.9.9.9") =>
  api("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify(body),
  });

describe("POST /oauth/register", () => {
  it("a valid body returns 201 with a client_id for a public client", async () => {
    const res = await register({
      client_name: "Claude Code",
      redirect_uris: ["http://localhost:33418/callback", "https://app.example/cb"],
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = await json<Record<string, unknown>>(res);
    expect(body).toMatchObject({
      client_name: "Claude Code",
      redirect_uris: ["http://localhost:33418/callback", "https://app.example/cb"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    expect(typeof body.client_id).toBe("string");
    const row = await env.DB.prepare("SELECT name, ip FROM oauth_clients WHERE id = ?")
      .bind(body.client_id)
      .first();
    expect(row).toEqual({ name: "Claude Code", ip: "9.9.9.9" });
  });

  it("client_name defaults to MCP client; loopback 127.0.0.1 and [::1] are allowed", async () => {
    const res = await register({
      redirect_uris: ["http://127.0.0.1/cb", "http://[::1]:8080/cb"],
    });
    expect(res.status).toBe(201);
    expect((await json<{ client_name: string }>(res)).client_name).toBe("MCP client");
  });

  it.each([
    ["a javascript: URI", { redirect_uris: ["javascript:alert(1)"] }],
    ["plain http to another host", { redirect_uris: ["http://evil.example/cb"] }],
    ["a fragment", { redirect_uris: ["https://app.example/cb#x"] }],
    ["a custom scheme", { redirect_uris: ["cursor://callback"] }],
    ["no URIs", { redirect_uris: [] }],
    ["11 URIs", { redirect_uris: Array.from({ length: 11 }, (_, i) => `https://a.example/${i}`) }],
    [
      "a 101-character name",
      { client_name: "x".repeat(101), redirect_uris: ["https://a.example/cb"] },
    ],
    [
      "a client secret auth method",
      {
        token_endpoint_auth_method: "client_secret_basic",
        redirect_uris: ["https://a.example/cb"],
      },
    ],
    ["not JSON", "nope"],
  ])("%s → 400 invalid_client_metadata", async (_name, body) => {
    const res = await register(body);
    expect(res.status).toBe(400);
    expect((await json<{ error: string }>(res)).error).toBe("invalid_client_metadata");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM oauth_clients").first())?.n).toBe(0);
  });

  it("the 11th pending client from one IP and the 501st overall get 429", async () => {
    const ok = { redirect_uris: ["https://a.example/cb"] };
    for (let i = 0; i < 10; i++) expect((await register(ok, "1.1.1.1")).status).toBe(201);
    expect((await register(ok, "1.1.1.1")).status).toBe(429);
    expect((await register(ok, "2.2.2.2")).status).toBe(201);

    const now = Date.now();
    const insert = env.DB.prepare(
      "INSERT INTO oauth_clients (id, name, redirect_uris, ip, created_at) VALUES (?, 'x', '[]', ?, ?)",
    );
    await env.DB.batch(
      Array.from({ length: 489 }, (_, i) => insert.bind(`c${i}`, `10.0.${i >> 8}.${i & 255}`, now)),
    );
    expect((await register(ok, "3.3.3.3")).status).toBe(429);
  });

  it("IPv6 registrations are capped per /64, not per address", async () => {
    const ok = { redirect_uris: ["https://a.example/cb"] };
    for (let i = 1; i <= 10; i++) {
      expect((await register(ok, `2001:db8:1:2::${i.toString(16)}`)).status).toBe(201);
    }
    expect((await register(ok, "2001:db8:1:2:ffff::1")).status).toBe(429);
    expect((await register(ok, "2001:db8:1:3::1")).status).toBe(201);
  });
});
