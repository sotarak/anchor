#!/usr/bin/env node
// Release notes from CHANGELOG.md: the body of one `## [<version>]` section.
//
//   node scripts/changelog.mjs <version>     # prints the notes, exits 1 when the section is missing
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * @param {string} changelog the whole CHANGELOG.md
 * @param {string} version for example "0.1.0" (no leading "v")
 * @returns {string} the section body, without its heading, trimmed, ending in one newline
 */
export function releaseNotes(changelog, version) {
  const lines = changelog.split("\n");
  const heading = new RegExp(`^## \\[${escapeRegExp(version)}\\](\\s|$)`);
  const start = lines.findIndex((l) => heading.test(l));
  if (start === -1) throw new Error(`CHANGELOG.md has no "## [${version}]" section`);
  const rest = lines.slice(start + 1);
  // The section ends at the next version heading or at the link definitions ("[x]: url").
  const end = rest.findIndex((l) => l.startsWith("## [") || /^\[[^\]]+\]: /.test(l));
  return `${(end === -1 ? rest : rest.slice(0, end)).join("\n").trim()}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const version = process.argv[2];
  if (!version) {
    console.error("usage: node scripts/changelog.mjs <version>");
    process.exit(2);
  }
  try {
    process.stdout.write(releaseNotes(readFileSync("CHANGELOG.md", "utf8"), version));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
