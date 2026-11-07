import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAnchorEnv } from "../../src/index";

const BASE = {
  apiUrl: "https://anchor.example.com",
  token: "anc_st_test",
  project: "zepo",
  environment: "prod",
};
const KEYS = ["ANCHOR_T_PORT", "ANCHOR_T_DEBUG", "ANCHOR_T_LIMITS", "ANCHOR_T_NAME"];

const secret = (key: string, type: string, value: string) => ({
  key,
  path: "/",
  version: 1,
  comment: "",
  updatedAt: 0,
  type,
  sensitive: true,
  value,
});

const fetch = (() =>
  vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          secrets: [
            secret("ANCHOR_T_PORT", "number", "9000"),
            secret("ANCHOR_T_DEBUG", "boolean", "true"),
            secret("ANCHOR_T_LIMITS", "json", '{"rps":10}'),
            secret("ANCHOR_T_NAME", "string", "zepo-engine"),
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  )) as unknown as () => typeof globalThis.fetch;

describe("loadAnchorEnv", () => {
  beforeEach(() => {
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) delete process.env[k];
    vi.restoreAllMocks();
  });

  it("writes the stored strings into process.env", async () => {
    const result = await loadAnchorEnv({ ...BASE, fetch: fetch() });
    expect(result).toEqual({ loaded: 4 });
    expect(process.env.ANCHOR_T_PORT).toBe("9000");
    expect(process.env.ANCHOR_T_DEBUG).toBe("true");
    expect(process.env.ANCHOR_T_LIMITS).toBe('{"rps":10}');
    expect(process.env.ANCHOR_T_NAME).toBe("zepo-engine");
  });

  it("keeps an existing variable", async () => {
    process.env.ANCHOR_T_PORT = "3000";
    const result = await loadAnchorEnv({ ...BASE, fetch: fetch() });
    expect(process.env.ANCHOR_T_PORT).toBe("3000");
    expect(result).toEqual({ loaded: 3 });
  });

  it("replaces an existing variable with override: true", async () => {
    process.env.ANCHOR_T_PORT = "3000";
    const result = await loadAnchorEnv({ ...BASE, override: true, fetch: fetch() });
    expect(process.env.ANCHOR_T_PORT).toBe("9000");
    expect(result).toEqual({ loaded: 4 });
  });

  it("never logs", async () => {
    const spies = [
      vi.spyOn(console, "log"),
      vi.spyOn(console, "info"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "error"),
      vi.spyOn(console, "debug"),
      vi.spyOn(process.stdout, "write"),
      vi.spyOn(process.stderr, "write"),
    ];
    await loadAnchorEnv({ ...BASE, fetch: fetch() });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("writes nothing when loading fails", async () => {
    const failing = vi.fn(
      async () => new Response("{}", { status: 401 }),
    ) as unknown as typeof globalThis.fetch;
    await expect(loadAnchorEnv({ ...BASE, fetch: failing })).rejects.toMatchObject({ status: 401 });
    for (const k of KEYS) expect(process.env[k]).toBeUndefined();
  });
});
