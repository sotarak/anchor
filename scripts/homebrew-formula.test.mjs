import assert from "node:assert/strict";
import { test } from "node:test";
import { homebrewFormula, parseSums } from "./homebrew-formula.mjs";

const hex = (c) => c.repeat(64);
const SUMS = {
  "anchor-darwin-arm64": hex("a"),
  "anchor-darwin-x64": hex("b"),
  "anchor-linux-arm64": hex("c"),
  "anchor-linux-x64": hex("d"),
  "anchor-windows-x64.exe": hex("e"),
};

test("parseSums reads sha256sum output", () => {
  const text = `${hex("1")}  anchor-linux-x64\n${hex("2")} *anchor-darwin-arm64\n\n`;
  assert.deepEqual(parseSums(text), {
    "anchor-linux-x64": hex("1"),
    "anchor-darwin-arm64": hex("2"),
  });
});

test("homebrewFormula pins every macOS and Linux asset to its checksum", () => {
  const rb = homebrewFormula({ version: "0.2.0", sums: SUMS });
  const lines = rb.split("\n").map((l) => l.trim());
  for (const asset of [
    "anchor-darwin-arm64",
    "anchor-darwin-x64",
    "anchor-linux-arm64",
    "anchor-linux-x64",
  ]) {
    const url = `url "https://github.com/sotarak/anchor/releases/download/v0.2.0/${asset}"`;
    const i = lines.indexOf(url);
    assert.notEqual(i, -1, `no url line for ${asset}`);
    assert.equal(lines[i + 1], `sha256 "${SUMS[asset]}"`);
  }
  assert.ok(lines.includes('version "0.2.0"'));
  assert.ok(!rb.includes("windows"));
});

test("homebrewFormula installs both command names", () => {
  const rb = homebrewFormula({ version: "0.2.0", sums: SUMS });
  assert.ok(rb.includes('=> "anchor"'));
  assert.ok(rb.includes('bin.install_symlink "anchor" => "anchor-secrets"'));
});

test("homebrewFormula throws for a missing asset", () => {
  const { "anchor-linux-arm64": _, ...rest } = SUMS;
  assert.throws(() => homebrewFormula({ version: "0.2.0", sums: rest }), /anchor-linux-arm64/);
});

test("homebrewFormula rejects a malformed checksum", () => {
  const sums = { ...SUMS, "anchor-darwin-x64": "abc" };
  assert.throws(() => homebrewFormula({ version: "0.2.0", sums }), /sha256/i);
});
