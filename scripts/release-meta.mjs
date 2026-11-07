#!/usr/bin/env node
// Release channel for a version: a pre-release suffix ("0.2.0-rc.1") makes a GitHub pre-release,
// goes to the npm dist-tag "next" and skips Homebrew.
//
//   node scripts/release-meta.mjs <version>   # prints prerelease=<bool> and npm_tag=<tag> lines
import { pathToFileURL } from "node:url";

const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/;

/**
 * @param {string} version for example "0.2.0" or "0.2.0-rc.1" (no leading "v")
 * @returns {{ prerelease: boolean; npmTag: "latest" | "next" }}
 */
export function releaseMeta(version) {
  if (!SEMVER.test(version)) throw new Error(`not a release version: ${version}`);
  const prerelease = version.includes("-");
  return { prerelease, npmTag: prerelease ? "next" : "latest" };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const version = process.argv[2];
  if (!version) {
    console.error("usage: node scripts/release-meta.mjs <version>");
    process.exit(2);
  }
  try {
    const { prerelease, npmTag } = releaseMeta(version);
    process.stdout.write(`prerelease=${prerelease}\nnpm_tag=${npmTag}\n`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
