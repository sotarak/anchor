import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAnchorEnv } from "../../src/index";

const BASE = {
  apiUrl: "https://anchor.example.com",
  token: "anc_st_test",
  project: "zepo",
  environment: "prod",
};
const KEYS = ["NEST_T_PORT", "NEST_T_DEBUG", "NEST_T_LIMITS", "NEST_T_NAME"];

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
            secret("NEST_T_PORT", "number", "9000"),
            secret("NEST_T_DEBUG", "boolean", "true"),
            secret("NEST_T_LIMITS", "json", '{"rps":10}'),
            secret("NEST_T_NAME", "string", "zepo-engine"),
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
    expect(result).toEqual({ loaded: 4, skipped: [] });
    expect(process.env.NEST_T_PORT).toBe("9000");
    expect(process.env.NEST_T_DEBUG).toBe("true");
    expect(process.env.NEST_T_LIMITS).toBe('{"rps":10}');
    expect(process.env.NEST_T_NAME).toBe("zepo-engine");
  });

  it("keeps an existing variable", async () => {
    process.env.NEST_T_PORT = "3000";
    const result = await loadAnchorEnv({ ...BASE, fetch: fetch() });
    expect(process.env.NEST_T_PORT).toBe("3000");
    expect(result).toEqual({ loaded: 3, skipped: [] });
  });

  it("replaces an existing variable with override: true", async () => {
    process.env.NEST_T_PORT = "3000";
    const result = await loadAnchorEnv({ ...BASE, override: true, fetch: fetch() });
    expect(process.env.NEST_T_PORT).toBe("9000");
    expect(result).toEqual({ loaded: 4, skipped: [] });
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

  describe("reserved names", () => {
    const withReserved = (() =>
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              secrets: [
                secret("NODE_OPTIONS", "string", "--require=/tmp/x.js"),
                secret("NEST_T_NAME", "string", "zepo-engine"),
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      )) as unknown as () => typeof globalThis.fetch;
    let saved: string | undefined;
    beforeEach(() => {
      saved = process.env.NODE_OPTIONS;
    });
    afterEach(() => {
      if (saved === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = saved;
    });

    it("skips them and reports their names as a process warning", async () => {
      const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
      const result = await loadAnchorEnv({ ...BASE, override: true, fetch: withReserved() });
      expect(result).toEqual({ loaded: 1, skipped: ["NODE_OPTIONS"] });
      expect(process.env.NODE_OPTIONS).toBe(saved);
      expect(process.env.NEST_T_NAME).toBe("zepo-engine");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        "Anchor skipped reserved names: NODE_OPTIONS (set allowReservedKeys to load them)",
        "AnchorWarning",
      );
    });

    it("loads them with allowReservedKeys: true", async () => {
      const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
      const result = await loadAnchorEnv({
        ...BASE,
        override: true,
        allowReservedKeys: true,
        fetch: withReserved(),
      });
      expect(result).toEqual({ loaded: 2, skipped: [] });
      expect(process.env.NODE_OPTIONS).toBe("--require=/tmp/x.js");
      expect(warn).not.toHaveBeenCalled();
    });
  });

  it("writes nothing when loading fails", async () => {
    const failing = vi.fn(
      async () => new Response("{}", { status: 401 }),
    ) as unknown as typeof globalThis.fetch;
    await expect(loadAnchorEnv({ ...BASE, fetch: failing })).rejects.toMatchObject({ status: 401 });
    for (const k of KEYS) expect(process.env[k]).toBeUndefined();
  });
});
