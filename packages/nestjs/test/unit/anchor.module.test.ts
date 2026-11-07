import "reflect-metadata";
import { AnchorError } from "@anchor-secrets/sdk";
import { Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as nestExports from "../../src/index";
import { ANCHOR_OPTIONS, type AnchorEvent, AnchorModule, AnchorService } from "../../src/index";

const BASE = {
  apiUrl: "https://anchor.example.com",
  token: "anc_st_test",
  project: "zepo",
  environment: "prod",
};

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

function fakeFetch() {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          secrets: [secret("PORT", "number", "9000"), secret("NAME", "string", "zepo-engine")],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
}

const failingFetch = () =>
  vi.fn(
    async () =>
      new Response(JSON.stringify({ error: { code: "forbidden", message: "No access" } }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
  );

describe("AnchorModule.forRoot", () => {
  it("loads the secrets once and serves typed values", async () => {
    const fetch = fakeFetch();
    const moduleRef = await Test.createTestingModule({
      imports: [
        AnchorModule.forRoot({ ...BASE, fetch: fetch as unknown as typeof globalThis.fetch }),
      ],
    }).compile();
    const anchor = moduleRef.get(AnchorService);
    expect(anchor.get("PORT")).toBe(9000);
    expect(anchor.get<string>("NAME")).toBe("zepo-engine");
    expect(anchor.get("MISSING")).toBeUndefined();
    expect(anchor.has("PORT")).toBe(true);
    expect(anchor.has("MISSING")).toBe(false);
    expect(anchor.keys().sort()).toEqual(["NAME", "PORT"]);
    expect(anchor.toObject()).toEqual({ PORT: 9000, NAME: "zepo-engine" });
    moduleRef.get(AnchorService);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("getOrThrow names the missing key", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AnchorModule.forRoot({ ...BASE, fetch: fakeFetch() as unknown as typeof fetch })],
    }).compile();
    const anchor = moduleRef.get(AnchorService);
    expect(anchor.getOrThrow("PORT")).toBe(9000);
    expect(() => anchor.getOrThrow("MISSING")).toThrow("Anchor secret MISSING is not set");
  });

  it("passes the folder to the client", async () => {
    const fetch = fakeFetch();
    await Test.createTestingModule({
      imports: [
        AnchorModule.forRoot({
          ...BASE,
          path: "/shared",
          fetch: fetch as unknown as typeof globalThis.fetch,
        }),
      ],
    }).compile();
    expect(String(fetch.mock.calls[0]?.[0])).toContain("path=%2Fshared");
  });

  it("makes compile() reject with AnchorError when loading fails", async () => {
    const err = await Test.createTestingModule({
      imports: [
        AnchorModule.forRoot({ ...BASE, fetch: failingFetch() as unknown as typeof fetch }),
      ],
    })
      .compile()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AnchorError);
    expect((err as AnchorError).code).toBe("forbidden");
  });

  it("is global by default", async () => {
    const seen: unknown[] = [];
    @Module({
      providers: [
        {
          provide: "consumer",
          useFactory: (anchor: AnchorService) => seen.push(anchor.get("PORT")),
          inject: [AnchorService],
        },
      ],
    })
    class FeatureModule {}
    await Test.createTestingModule({
      imports: [
        AnchorModule.forRoot({ ...BASE, fetch: fakeFetch() as unknown as typeof fetch }),
        FeatureModule,
      ],
    }).compile();
    expect(seen).toEqual([9000]);
  });

  it("stays local with isGlobal: false", async () => {
    @Module({
      providers: [
        { provide: "consumer", useFactory: (a: AnchorService) => a, inject: [AnchorService] },
      ],
    })
    class FeatureModule {}
    await expect(
      Test.createTestingModule({
        imports: [
          AnchorModule.forRoot({
            ...BASE,
            isGlobal: false,
            fetch: fakeFetch() as unknown as typeof fetch,
          }),
          FeatureModule,
        ],
      }).compile(),
    ).rejects.toThrow(/AnchorService/);
  });
});

describe("AnchorModule.forRootAsync", () => {
  it("builds the options from injected providers", async () => {
    const fetch = fakeFetch();
    @Module({
      providers: [{ provide: "settings", useValue: { env: "prod" } }],
      exports: ["settings"],
    })
    class SettingsModule {}
    const moduleRef = await Test.createTestingModule({
      imports: [
        AnchorModule.forRootAsync({
          imports: [SettingsModule],
          inject: ["settings"],
          useFactory: async (settings: { env: string }) => ({
            ...BASE,
            environment: settings.env,
            fetch: fetch as unknown as typeof globalThis.fetch,
          }),
        }),
      ],
    }).compile();
    expect(moduleRef.get(AnchorService).get("PORT")).toBe(9000);
    expect(moduleRef.get(ANCHOR_OPTIONS)).toMatchObject({ project: "zepo", environment: "prod" });
    expect(String(fetch.mock.calls[0]?.[0])).toContain("/environments/prod/");
  });

  it("makes compile() reject with AnchorError when loading fails", async () => {
    const err = await Test.createTestingModule({
      imports: [
        AnchorModule.forRootAsync({
          useFactory: () => ({ ...BASE, fetch: failingFetch() as unknown as typeof fetch }),
        }),
      ],
    })
      .compile()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AnchorError);
  });
});

describe("refreshing", () => {
  afterEach(() => vi.useRealTimers());

  const versions = () => {
    let n = 0;
    return vi.fn(async () => {
      n++;
      return new Response(JSON.stringify({ secrets: [secret("NAME", "string", `v${n}`)] }), {
        status: 200,
      });
    });
  };

  it("refreshes values in the background after ttl", async () => {
    vi.useFakeTimers();
    const fetch = versions();
    const moduleRef = await Test.createTestingModule({
      imports: [
        AnchorModule.forRoot({
          ...BASE,
          fetch: fetch as unknown as typeof globalThis.fetch,
          cache: { ttlMs: 1_000 },
        }),
      ],
    }).compile();
    const anchor = moduleRef.get(AnchorService);
    expect(anchor.get("NAME")).toBe("v1");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(anchor.get("NAME")).toBe("v1");
    await vi.advanceTimersByTimeAsync(0);
    expect(anchor.get("NAME")).toBe("v2");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refresh() fetches now", async () => {
    const fetch = versions();
    const moduleRef = await Test.createTestingModule({
      imports: [
        AnchorModule.forRoot({ ...BASE, fetch: fetch as unknown as typeof globalThis.fetch }),
      ],
    }).compile();
    const anchor = moduleRef.get(AnchorService);
    await anchor.refresh();
    expect(anchor.get("NAME")).toBe("v2");
  });

  it("passes retry and onEvent through to the SDK", async () => {
    const events: AnchorEvent[] = [];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: "unavailable", message: "Busy" } }), {
          status: 503,
        }),
      )
      .mockResolvedValue(
        new Response(JSON.stringify({ secrets: [secret("NAME", "string", "ok")] }), {
          status: 200,
        }),
      );
    const moduleRef = await Test.createTestingModule({
      imports: [
        AnchorModule.forRoot({
          ...BASE,
          fetch: fetch as unknown as typeof globalThis.fetch,
          retry: { baseDelayMs: 1 },
          onEvent: (e) => events.push(e),
        }),
      ],
    }).compile();
    expect(moduleRef.get(AnchorService).get("NAME")).toBe("ok");
    expect(events.map((e) => e.type)).toEqual(["retry"]);
  });

  it("no longer exports ANCHOR_SECRETS", () => {
    expect("ANCHOR_SECRETS" in nestExports).toBe(false);
  });
});
