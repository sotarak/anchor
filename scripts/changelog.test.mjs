import assert from "node:assert/strict";
import { test } from "node:test";
import { releaseNotes } from "./changelog.mjs";

const CHANGELOG = `# Changelog

Intro.

## [Unreleased]

## [0.1.0] - 2026-11-07

First release.

### Added

- Things.

## [0.0.9] - 2026-01-01

- Older.

[Unreleased]: https://example.org/compare/v0.1.0...HEAD
`;

test("releaseNotes returns the 0.1.0 section only", () => {
  const notes = releaseNotes(CHANGELOG, "0.1.0");
  assert.equal(notes, "First release.\n\n### Added\n\n- Things.\n");
});

test("releaseNotes stops at the link definitions after the last section", () => {
  assert.equal(releaseNotes(CHANGELOG, "0.0.9"), "- Older.\n");
});

test("releaseNotes throws for a missing version", () => {
  assert.throws(() => releaseNotes(CHANGELOG, "0.2.0"), /0\.2\.0/);
});

test("releaseNotes does not treat 0.1.0 as a prefix of 0.1.01", () => {
  const other = "## [0.1.01] - 2026-11-07\n\nWrong.\n";
  assert.throws(() => releaseNotes(other, "0.1.0"), /0\.1\.0/);
});
