import { describe, expect, it, vi } from "vitest";
import { ApiError } from "#src/lib/errors";
import { createResolver, type SecretAddress } from "#src/references/resolve";

type Store = Record<string, string>; // "env:/path/KEY" or "env:/KEY" -> raw value

const addrKey = (a: SecretAddress) => `${a.environment}:${a.path === "/" ? "" : a.path}/${a.key}`;
const at = (environment: string, path: string, key: string): SecretAddress => ({
  environment,
  path,
  key,
});

function setup(store: Store, forbidden: string[] = []) {
  const load = vi.fn(async (a: SecretAddress) => store[addrKey(a)] ?? null);
  const authorize = vi.fn(async (a: SecretAddress) => {
    if (forbidden.includes(addrKey(a)))
      throw new ApiError(403, "forbidden", "You do not have permission to perform this action");
  });
  return { resolver: createResolver({ load, authorize }), load, authorize };
}

async function failure(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error("expected an ApiError");
}

const A = at("dev", "/", "A");

describe("createResolver", () => {
  it("expands same-folder and cross-env references", async () => {
    const { resolver } = setup({
      "dev:/db/USER": "u",
      "prod:/db/PASSWORD": "p@ss",
      "prod:/HOST": "h",
    });
    const out = await resolver.expand(
      at("dev", "/db", "URL"),
      "postgres://${USER}:${prod:/db/PASSWORD}@${prod:/HOST}/x",
    );
    expect(out.value).toBe("postgres://u:p@ss@h/x");
  });

  it("referenced values expand relative to their own folder", async () => {
    const { resolver } = setup({ "prod:/db/URL": "${HOST}:5432", "prod:/db/HOST": "db.internal" });
    expect((await resolver.expand(A, "${prod:/db/URL}")).value).toBe("db.internal:5432");
  });

  it("escaped $${ stays literal and is not loaded", async () => {
    const { resolver, load, authorize } = setup({});
    expect((await resolver.expand(A, "echo $${HOME} ${VAR:-x}")).value).toBe(
      "echo ${HOME} ${VAR:-x}",
    );
    expect(load).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });

  it("missing target -> 400 naming secret and reference with escape hint", async () => {
    const { resolver } = setup({});
    const err = await failure(resolver.expand(at("dev", "/api", "CMD"), "echo ${HOME}"));
    expect(err.status).toBe(400);
    expect(err.code).toBe("bad_request");
    expect(err.message).toBe(
      "Unresolved reference ${HOME} in dev:/api/CMD; escape a literal with $${",
    );
  });

  it("forbidden target -> 403 and load is never called", async () => {
    const { resolver, load } = setup({ "prod:/DB_PASSWORD": "secret-value" }, [
      "prod:/DB_PASSWORD",
    ]);
    const err = await failure(resolver.expand(A, "x${prod:/DB_PASSWORD}"));
    expect(err.status).toBe(403);
    expect(err.code).toBe("forbidden");
    expect(err.message).toContain("${prod:/DB_PASSWORD}");
    expect(err.message).toContain("dev:/A");
    expect(err.message).not.toContain("secret-value");
    expect(load).not.toHaveBeenCalled();
  });

  it("forbidden and missing target -> 403, not 400 (no existence oracle)", async () => {
    const present = setup({ "prod:/X": "v" }, ["prod:/X"]);
    const absent = setup({}, ["prod:/X"]);
    const a = await failure(present.resolver.expand(A, "${prod:/X}"));
    const b = await failure(absent.resolver.expand(A, "${prod:/X}"));
    expect([a.status, b.status]).toEqual([403, 403]);
    expect(a.message).toBe(b.message);
  });

  it("self reference ${A} in A -> 400 cycle", async () => {
    const { resolver } = setup({ "dev:/A": "${A}" });
    const err = await failure(resolver.expand(A, "${A}"));
    expect(err.status).toBe(400);
    expect(err.message).toBe("Reference cycle: dev:/A -> dev:/A");
  });

  it("A->B->A -> 400 cycle listing the path", async () => {
    const { resolver } = setup({ "dev:/A": "${B}", "dev:/B": "${A}" });
    const err = await failure(resolver.expand(A, "${B}"));
    expect(err.status).toBe(400);
    expect(err.message).toBe("Reference cycle: dev:/A -> dev:/B -> dev:/A");
  });

  it("depth 5 chain ok, depth 6 -> 400", async () => {
    // A -> B -> C -> D -> E -> F is five hops.
    const five = setup({
      "dev:/B": "${C}",
      "dev:/C": "${D}",
      "dev:/D": "${E}",
      "dev:/E": "${F}",
      "dev:/F": "end",
    });
    expect((await five.resolver.expand(A, "${B}")).value).toBe("end");
    const six = setup({
      "dev:/B": "${C}",
      "dev:/C": "${D}",
      "dev:/D": "${E}",
      "dev:/E": "${F}",
      "dev:/F": "${G}",
      "dev:/G": "end",
    });
    const err = await failure(six.resolver.expand(A, "${B}"));
    expect(err.status).toBe(400);
    expect(err.message).toBe("Reference depth exceeds 5 at dev:/G");
  });

  it("depth counts through memoized secrets too", async () => {
    // X is first reached shallowly (memoized), then again at a depth where its chain is too long.
    const { resolver } = setup({
      "dev:/X": "${Y}",
      "dev:/Y": "${Z}",
      "dev:/Z": "end",
      "dev:/B": "${C}",
      "dev:/C": "${D}",
      "dev:/D": "${E}",
      "dev:/E": "${X}",
    });
    expect((await resolver.expand(A, "${X}")).value).toBe("end");
    const err = await failure(resolver.expand(A, "${B}"));
    expect(err.status).toBe(400);
    expect(err.message).toMatch(/^Reference depth exceeds 5 at /);
  });

  it("diamond loads D once", async () => {
    const { resolver, load } = setup({ "dev:/B": "${D}", "dev:/C": "${D}", "dev:/D": "d" });
    expect((await resolver.expand(A, "${B}${C}")).value).toBe("dd");
    expect(load.mock.calls.filter(([a]) => a.key === "D")).toHaveLength(1);
  });

  it("doubling chain with a 64 KiB leaf -> 400 size, not OOM", async () => {
    const store: Store = { "dev:/L": "x".repeat(65_536) };
    const chain = ["B", "C", "D", "E"]; // A -> B -> C -> D -> E -> L: five hops, B is exactly 1 MiB
    chain.forEach((k, i) => {
      store[`dev:/${k}`] = `\${${chain[i + 1] ?? "L"}}\${${chain[i + 1] ?? "L"}}`;
    });
    const { resolver } = setup(store);
    const err = await failure(resolver.expand(A, "${B}${B}"));
    expect(err.status).toBe(400);
    expect(err.message).toBe("Expanded value exceeds 1048576 bytes");
  });

  it("references may add at most 16 MiB to one request, however the memo shares them", async () => {
    const store: Store = { "dev:/BIG": "x".repeat(65_536) };
    const { resolver, load } = setup(store);
    const sixteenRefs = "${BIG}".repeat(16); // 1 MiB each, the per-value maximum
    for (let i = 0; i < 16; i++) {
      expect((await resolver.expand(at("dev", "/", `V${i}`), sixteenRefs)).value).toHaveLength(
        1_048_576,
      );
    }
    const err = await failure(resolver.expand(at("dev", "/", "V16"), sixteenRefs));
    expect(err.status).toBe(400);
    expect(err.message).toBe("References add more than 16777216 bytes to one request");
    expect(load).toHaveBeenCalledTimes(1); // the memo kept loads at one: only the byte budget stops it
  });

  it("plain text does not count toward the per-request reference budget", async () => {
    const { resolver } = setup({});
    const big = "x".repeat(1_048_576);
    for (let i = 0; i < 20; i++) {
      expect((await resolver.expand(at("dev", "/", `P${i}`), big)).value).toBe(big);
    }
  });

  it("501 distinct references -> 400", async () => {
    const store: Store = {};
    const keys = Array.from({ length: 501 }, (_, i) => `K${i}`);
    for (const k of keys) store[`dev:/${k}`] = "v";
    const { resolver } = setup(store);
    const ok = await resolver.expand(
      A,
      keys
        .slice(0, 500)
        .map((k) => `\${${k}}`)
        .join(""),
    );
    expect(ok.value).toBe("v".repeat(500));
    const err = await failure(
      createResolver({
        load: async (a) => store[addrKey(a)] ?? null,
        authorize: async () => {},
      }).expand(A, keys.map((k) => `\${${k}}`).join("")),
    );
    expect(err.status).toBe(400);
    expect(err.message).toBe("References load more than 500 secrets");
  });

  it("referenced lists unique addresses", async () => {
    const { resolver } = setup({ "dev:/B": "${D}", "dev:/C": "${D}", "dev:/D": "d" });
    const out = await resolver.expand(A, "${B}${C}${B}");
    expect(out.referenced.map(addrKey).sort()).toEqual(["dev:/B", "dev:/C", "dev:/D"]);
  });

  it("a value without references is returned as is, with nothing referenced", async () => {
    const { resolver } = setup({});
    expect(await resolver.expand(A, "plain $HOME")).toEqual({
      value: "plain $HOME",
      referenced: [],
    });
  });
});
