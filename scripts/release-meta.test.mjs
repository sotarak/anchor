import assert from "node:assert/strict";
import { test } from "node:test";
import { releaseMeta } from "./release-meta.mjs";

test("a plain version is a stable release on latest", () => {
  assert.deepEqual(releaseMeta("0.2.0"), { prerelease: false, npmTag: "latest" });
});

test("a pre-release suffix goes to next", () => {
  assert.deepEqual(releaseMeta("0.2.0-rc.1"), { prerelease: true, npmTag: "next" });
});

test("releaseMeta rejects a non-semver version", () => {
  assert.throws(() => releaseMeta("v0.2"), /v0\.2/);
});

test("releaseMeta rejects an empty pre-release suffix", () => {
  assert.throws(() => releaseMeta("0.2.0-"), /0\.2\.0-/);
});
