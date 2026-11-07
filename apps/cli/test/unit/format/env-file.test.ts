import type { SecretValueType } from "@anchor/shared";
import { parse as parseDotenv } from "dotenv";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { CliError, EXIT } from "#src/errors";
import { type Entry, formatDotenv, formatJson, formatYaml } from "#src/format/env-file";

const e = (key: string, value: string, type: SecretValueType = "string"): Entry => ({
  key,
  value,
  type,
});

const VALUES = [
  "plain",
  "with space",
  "has#hash",
  "a=b",
  "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----",
  'say "hi"',
  "it's",
  `both ' and "`,
  "",
  "🔑 ünïcødé",
  "C:\\path\\name",
  "  padded  ",
  "trailing newline\n",
  "it's\nmulti-line",
  "back`tick and 'quote'",
  "$HOME $" + "{X}",
];

describe("formatDotenv", () => {
  it("round-trips through the dotenv parser", () => {
    for (const v of VALUES) {
      const text = formatDotenv([e("K", v)]);
      expect(parseDotenv(text).K, `value ${JSON.stringify(v)} as ${text}`).toBe(v);
    }
  });

  it("uses the simplest quoting that round-trips", () => {
    expect(formatDotenv([e("A", "plain-1.2:3@x/y+z,w")])).toBe("A=plain-1.2:3@x/y+z,w\n");
    expect(formatDotenv([e("A", "with space")])).toBe("A='with space'\n");
    expect(formatDotenv([e("A", "a\nb")])).toBe('A="a\\nb"\n');
    expect(formatDotenv([e("A", `both ' and "`)])).toBe("A=`both ' and \"`\n");
    expect(formatDotenv([e("A", "")])).toBe("A=\n");
  });

  it("writes one line per entry", () => {
    const text = formatDotenv([e("A", "1"), e("B", "x y")]);
    expect(text).toBe("A=1\nB='x y'\n");
    expect(parseDotenv(text)).toEqual({ A: "1", B: "x y" });
  });

  it("a value with both a double quote and a newline fails clearly", () => {
    let err: unknown;
    try {
      formatDotenv([e("CERT", 'line "one"\nline two')]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).exitCode).toBe(EXIT.ERROR);
    expect((err as CliError).message).toBe("Value of CERT cannot be represented in dotenv format");
    expect((err as CliError).hint).toBe("Use --format json or --format yaml");
    expect((err as CliError).message).not.toContain("line one");
  });
});

describe("formatJson / formatYaml", () => {
  const entries = VALUES.map((v, i) => e(`K${String(i).padStart(2, "0")}`, v));
  const expected = Object.fromEntries(entries.map((x) => [x.key, x.value]));

  it("JSON round-trips with sorted keys, 2-space indent and a trailing newline", () => {
    const text = formatJson(entries);
    expect(JSON.parse(text)).toEqual(expected);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.split("\n")[1]?.startsWith('  "K00"')).toBe(true);
  });

  it("YAML round-trips, including keys YAML would read as non-strings", () => {
    expect(parseYaml(formatYaml(entries))).toEqual(expected);
    const tricky = [e("NULL", "x"), e("true", "y"), e("Y", "z")];
    expect(parseYaml(formatYaml(tricky))).toEqual({ NULL: "x", true: "y", Y: "z" });
  });

  it("JSON keeps a __proto__ key as data", () => {
    expect(JSON.parse(formatJson([e("__proto__", "x")]))).toEqual(JSON.parse('{"__proto__":"x"}'));
  });
});

describe("typed export", () => {
  const PEM =
    "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE\n-----END PUBLIC KEY-----\n";
  const typed = [
    e("PORT", "8080", "number"),
    e("ON", "true", "boolean"),
    e("MODELS", '["a","b"]', "list"),
    e("CFG", '{"x":[1]}', "json"),
    e("KEY", PEM, "pem"),
  ];
  const decoded = { CFG: { x: [1] }, KEY: PEM, MODELS: ["a", "b"], ON: true, PORT: 8080 };

  it("json export decodes typed values", () => {
    expect(JSON.parse(formatJson(typed))).toEqual(decoded);
  });

  it("yaml export decodes typed values", () => {
    const parsed = parseYaml(formatYaml(typed));
    expect(parsed).toEqual(decoded);
    expect(parsed.PORT).toBe(8080);
  });

  it("dotenv keeps canonical strings", () => {
    const parsed = parseDotenv(formatDotenv(typed));
    expect(parsed.PORT).toBe("8080");
    expect(parsed.MODELS).toBe('["a","b"]');
    expect(parsed.KEY).toBe(PEM);
  });
});
