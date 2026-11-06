import { parse as parseDotenv } from "dotenv";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { CliError, EXIT } from "#src/errors";
import { formatDotenv, formatJson, formatYaml } from "#src/format/env-file";

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
      const text = formatDotenv([["K", v]]);
      expect(parseDotenv(text).K, `value ${JSON.stringify(v)} as ${text}`).toBe(v);
    }
  });

  it("uses the simplest quoting that round-trips", () => {
    expect(formatDotenv([["A", "plain-1.2:3@x/y+z,w"]])).toBe("A=plain-1.2:3@x/y+z,w\n");
    expect(formatDotenv([["A", "with space"]])).toBe("A='with space'\n");
    expect(formatDotenv([["A", "a\nb"]])).toBe('A="a\\nb"\n');
    expect(formatDotenv([["A", `both ' and "`]])).toBe("A=`both ' and \"`\n");
    expect(formatDotenv([["A", ""]])).toBe("A=\n");
  });

  it("writes one line per entry", () => {
    const text = formatDotenv([
      ["A", "1"],
      ["B", "x y"],
    ]);
    expect(text).toBe("A=1\nB='x y'\n");
    expect(parseDotenv(text)).toEqual({ A: "1", B: "x y" });
  });

  it("a value with both a double quote and a newline fails clearly", () => {
    let err: unknown;
    try {
      formatDotenv([["CERT", 'line "one"\nline two']]);
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
  const entries = VALUES.map((v, i) => [`K${String(i).padStart(2, "0")}`, v] as [string, string]);
  const expected = Object.fromEntries(entries);

  it("JSON round-trips with sorted keys, 2-space indent and a trailing newline", () => {
    const text = formatJson(entries);
    expect(JSON.parse(text)).toEqual(expected);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.split("\n")[1]?.startsWith('  "K00"')).toBe(true);
  });

  it("YAML round-trips, including keys YAML would read as non-strings", () => {
    expect(parseYaml(formatYaml(entries))).toEqual(expected);
    const tricky: [string, string][] = [
      ["NULL", "x"],
      ["true", "y"],
      ["Y", "z"],
    ];
    expect(parseYaml(formatYaml(tricky))).toEqual({ NULL: "x", true: "y", Y: "z" });
  });

  it("JSON keeps a __proto__ key as data", () => {
    expect(JSON.parse(formatJson([["__proto__", "x"]]))).toEqual(JSON.parse('{"__proto__":"x"}'));
  });
});
