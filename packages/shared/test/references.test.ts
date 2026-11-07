import { describe, expect, it } from "vitest";
import {
  formatReference,
  REFERENCE_LIMITS,
  type RefTarget,
  tokenizeValue,
  type ValueToken,
} from "../src/references";

const text = (t: string): ValueToken => ({ type: "text", text: t });
/** A ref token for `raw` found at `start` in the input. */
const ref = (raw: string, target: RefTarget, start = 0): ValueToken => ({
  type: "ref",
  raw,
  target,
  start,
  end: start + raw.length,
});
const local = (key: string): RefTarget => ({ environment: null, path: null, key });

describe("tokenizeValue", () => {
  it.each<[string, ValueToken[]]>([
    ["plain", [text("plain")]],
    ["", []],
    ["${DB}", [ref("${DB}", local("DB"))]],
    [
      "x${prod:/DB_URL}y",
      [
        text("x"),
        ref("${prod:/DB_URL}", { environment: "prod", path: "/", key: "DB_URL" }, 1),
        text("y"),
      ],
    ],
    [
      "${prod:/db/PASSWORD}",
      [ref("${prod:/db/PASSWORD}", { environment: "prod", path: "/db", key: "PASSWORD" })],
    ],
    [
      "${dev-2:/a_b/c-d/K_1}",
      [ref("${dev-2:/a_b/c-d/K_1}", { environment: "dev-2", path: "/a_b/c-d", key: "K_1" })],
    ],
    ["$${DB}", [text("${DB}")]],
    // "$" + escaped "$${" -> "${" ; merged text, no ref
    ["$$${DB}", [text("$${DB}")]],
    ["$$$${DB}", [text("$$${DB}")]], // "$$" + escaped "$${"
    ["${VAR:-x}", [text("${VAR:-x}")]],
    ["${a b}", [text("${a b}")]],
    // env slug must be lowercase
    ["${Prod:/X}", [text("${Prod:/X}")]],
    ["${prod:/../X}", [text("${prod:/../X}")]],
    // path must start with /
    ["${prod:X}", [text("${prod:X}")]],
    ["${prod:/db/}", [text("${prod:/db/}")]],
    ["${1KEY}", [text("${1KEY}")]],
    ["${", [text("${")]],
    ["$", [text("$")]],
    ["a $HOME b", [text("a $HOME b")]],
    ["${A}${B}", [ref("${A}", local("A")), ref("${B}", local("B"), 4)]],
    ["$${A}${B}", [text("${A}"), ref("${B}", local("B"), 5)]],
  ])("%s", (input, expected) => {
    expect(tokenizeValue(input)).toEqual(expected);
  });

  it("a path deeper than 10 segments stays literal", () => {
    const deep = `\${prod:/${Array.from({ length: 11 }, () => "s").join("/")}/K}`;
    expect(tokenizeValue(deep)).toEqual([text(deep)]);
  });

  it("formatReference round-trips through tokenizeValue", () => {
    const targets: RefTarget[] = [
      local("DB"),
      { environment: "prod", path: "/", key: "DB_URL" },
      { environment: "prod", path: "/db/x", key: "PASSWORD" },
    ];
    for (const target of targets) {
      const raw = formatReference(target);
      expect(tokenizeValue(raw)).toEqual([ref(raw, target)]);
    }
  });

  it("tokenizes a 64 KiB value with 2,000 references in < 50 ms", () => {
    const piece = "${prod:/db/PASSWORD}xxxxxxxxxxx";
    const value = piece.repeat(2000).padEnd(65_536, "y");
    tokenizeValue(value); // warm up the JIT
    const t0 = performance.now();
    const tokens = tokenizeValue(value);
    const elapsed = performance.now() - t0;
    expect(tokens.filter((t) => t.type === "ref")).toHaveLength(2000);
    expect(elapsed).toBeLessThan(50);
  });
});

describe("REFERENCE_LIMITS", () => {
  it("pins the spec limits", () => {
    expect(REFERENCE_LIMITS).toEqual({
      maxDepth: 5,
      maxSecrets: 500,
      maxExpandedBytes: 1_048_576,
      maxReferencedBytesPerRequest: 16_777_216,
    });
  });
});
