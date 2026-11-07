import { describe, expect, it } from "vitest";
import { inferImportFormat, parseImport, toImportKey } from "#src/import/parse";

const PEM =
  "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE\n-----END PUBLIC KEY-----\n";

function usageMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toMatchObject({ name: "CliError", exitCode: 2 });
    return (e as Error).message;
  }
  throw new Error("expected parseImport to throw");
}

describe("parseImport", () => {
  it("flattens nested YAML into UPPER_SNAKE keys", () => {
    const { entries, empty } = parseImport(
      "configs:\n  openrouter:\n    api_key: sk-1\n  jwt:\n    expires_in: 12h\n",
      "yaml",
    );
    expect(entries).toEqual([
      {
        key: "CONFIGS_OPENROUTER_API_KEY",
        source: "configs.openrouter.api_key",
        value: "sk-1",
        type: "string",
      },
      {
        key: "CONFIGS_JWT_EXPIRES_IN",
        source: "configs.jwt.expires_in",
        value: "12h",
        type: "string",
      },
    ]);
    expect(empty).toEqual([]);
  });

  it("maps hyphens, dots and spaces", () => {
    const { entries } = parseImport('{"grpc-clients": {"a.b c": "x"}}', "json");
    expect(entries.map((e) => e.key)).toEqual(["GRPC_CLIENTS_A_B_C"]);
    expect(toImportKey(["transporters", "grpc-clients"])).toBe("TRANSPORTERS_GRPC_CLIENTS");
  });

  it("infers types from JSON/YAML values", () => {
    const yaml = [
      "port: 9000",
      "use_ssl: false",
      "models: [a, b]",
      "access_keys: []",
      "clients: [{name: x}]",
      `cert: ${JSON.stringify(PEM)}`,
      "fallback_reply: 'Xin lỗi, hệ thống đang bận.'",
    ].join("\n");
    const byKey = Object.fromEntries(
      parseImport(yaml, "yaml").entries.map((e) => [e.key, [e.type, e.value]]),
    );
    expect(byKey).toEqual({
      PORT: ["number", "9000"],
      USE_SSL: ["boolean", "false"],
      MODELS: ["list", '["a","b"]'],
      ACCESS_KEYS: ["list", "[]"],
      CLIENTS: ["json", '[{"name":"x"}]'],
      CERT: ["pem", PEM],
      FALLBACK_REPLY: ["string", "Xin lỗi, hệ thống đang bận."],
    });
  });

  it("numbers keep the text written in the file", () => {
    const byKey = (text: string, format: "json" | "yaml") =>
      Object.fromEntries(parseImport(text, format).entries.map((e) => [e.key, [e.type, e.value]]));
    expect(
      byKey(
        "version: 1.0\nhex: 0x1F\nexp: 1e3\nbig: 12345678901234567890\ninf: .inf\nport: 9000\n",
        "yaml",
      ),
    ).toEqual({
      VERSION: ["number", "1.0"],
      HEX: ["string", "0x1F"],
      EXP: ["number", "1e3"],
      BIG: ["number", "12345678901234567890"],
      INF: ["string", ".inf"],
      PORT: ["number", "9000"],
    });
    expect(byKey('{"v": 1.0, "big": 12345678901234567890, "n": {"x": -0.50}}', "json")).toEqual({
      V: ["number", "1.0"],
      BIG: ["number", "12345678901234567890"],
      N_X: ["number", "-0.50"],
    });
  });

  it("blank values are reported as empty", () => {
    const r = parseImport("configs:\n  api_key:\n  extra: {}\n", "yaml");
    expect(r.entries).toEqual([]);
    expect(r.empty).toEqual(["configs.api_key", "configs.extra"]);
  });

  it("dotenv values are strings", () => {
    const pem = "-----BEGIN KEY-----\nabc\n-----END KEY-----";
    const { entries } = parseImport(`PORT=9000\nKEY="${pem}"\n`, "dotenv");
    expect(entries).toEqual([
      { key: "PORT", source: "PORT", value: "9000", type: "string" },
      { key: "KEY", source: "KEY", value: pem, type: "string" },
    ]);
  });

  it("rejects a non-object document", () => {
    expect(usageMessage(() => parseImport("- a\n", "yaml"))).toBe(
      "The file must contain an object at the top level",
    );
    expect(usageMessage(() => parseImport("[1]", "json"))).toBe(
      "The file must contain an object at the top level",
    );
  });

  it("rejects malformed JSON or YAML without echoing it", () => {
    const msg = usageMessage(() => parseImport('{"a": "s3cr3t', "json"));
    expect(msg).toMatch(/^The file is not valid JSON/);
    expect(msg).not.toContain("s3cr3t");
  });

  it("rejects keys that cannot be Anchor keys", () => {
    expect(usageMessage(() => parseImport('{"2fa": "x"}', "json"))).toContain(
      "Cannot import 2fa: 2FA is not a valid key",
    );
    expect(usageMessage(() => parseImport("1BAD=x\n", "dotenv"))).toContain(
      "Cannot import 1BAD: 1BAD is not a valid key",
    );
  });

  it("rejects collisions", () => {
    expect(usageMessage(() => parseImport('{"a": {"b-c": "1", "b_c": "2"}}', "json"))).toContain(
      "a.b-c and a.b_c both become A_B_C",
    );
  });

  it("reports every error at once, never the value", () => {
    const big = "v".repeat(70_000);
    const msg = usageMessage(() =>
      parseImport(JSON.stringify({ "2fa": "x", huge: big, n: { ok: true } }), "json"),
    );
    const lines = msg.split("\n");
    expect(lines).toContain("Cannot import 2fa: 2FA is not a valid key");
    expect(lines.some((l) => l.startsWith("HUGE: "))).toBe(true);
    expect(msg).not.toContain(big.slice(0, 100));
  });
});

describe("inferImportFormat", () => {
  it("maps extensions and .env names", () => {
    expect(inferImportFormat("a.json")).toBe("json");
    expect(inferImportFormat("x.yml")).toBe("yaml");
    expect(inferImportFormat("dir/x.yaml")).toBe("yaml");
    expect(inferImportFormat(".env")).toBe("dotenv");
    expect(inferImportFormat("apps/api/.env.production")).toBe("dotenv");
    expect(inferImportFormat("prod.env")).toBe("dotenv");
    expect(inferImportFormat("config.txt")).toBeNull();
  });
});
