#!/usr/bin/env node
// The Homebrew formula (Formula/anchor.rb in sotarak/homebrew-tap) for one release, pinned to the
// release binaries and their SHA256SUMS.
//
//   node scripts/homebrew-formula.mjs <version> <path to SHA256SUMS>   # prints the formula
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** The release assets the formula installs, by Homebrew OS block and CPU block. */
const BLOCKS = [
  [
    "on_macos",
    [
      ["on_arm", "anchor-darwin-arm64"],
      ["on_intel", "anchor-darwin-x64"],
    ],
  ],
  [
    "on_linux",
    [
      ["on_arm", "anchor-linux-arm64"],
      ["on_intel", "anchor-linux-x64"],
    ],
  ],
];

/**
 * @param {string} text the contents of SHA256SUMS (`sha256sum` output)
 * @returns {Record<string, string>} asset name → hex digest
 */
export function parseSums(text) {
  const sums = {};
  for (const line of text.split("\n")) {
    const m = /^(\S+)\s+\*?(.+)$/.exec(line.trim());
    if (m) sums[m[2]] = m[1];
  }
  return sums;
}

/**
 * @param {{ version: string; sums: Record<string, string> }} release version without a leading "v"
 * @returns {string} the formula source
 */
export function homebrewFormula({ version, sums }) {
  const base = `https://github.com/sotarak/anchor/releases/download/v${version}`;
  const sha = (asset) => {
    const sum = sums[asset];
    if (sum === undefined) throw new Error(`SHA256SUMS has no entry for ${asset}`);
    if (!/^[0-9a-f]{64}$/.test(sum)) throw new Error(`malformed sha256 for ${asset}: ${sum}`);
    return sum;
  };
  const blocks = BLOCKS.map(
    ([os, cpus]) =>
      `  ${os} do\n${cpus
        .map(
          ([cpu, asset]) =>
            `    ${cpu} do\n      url "${base}/${asset}"\n      sha256 "${sha(asset)}"\n    end\n`,
        )
        .join("")}  end\n`,
  ).join("\n");

  return `class Anchor < Formula
  desc "CLI for Anchor, a self-hosted secrets manager on Cloudflare"
  homepage "https://sotarak.github.io/anchor/"
  version "${version}"
  license "Apache-2.0"

${blocks}
  def install
    bin.install Dir["anchor-*"].first => "anchor"
    bin.install_symlink "anchor" => "anchor-secrets"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/anchor --version").strip
  end
end
`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [version, sumsPath] = process.argv.slice(2);
  if (!version || !sumsPath) {
    console.error("usage: node scripts/homebrew-formula.mjs <version> <path to SHA256SUMS>");
    process.exit(2);
  }
  try {
    const sums = parseSums(readFileSync(sumsPath, "utf8"));
    process.stdout.write(homebrewFormula({ version, sums }));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
