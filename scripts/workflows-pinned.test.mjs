import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = join(import.meta.dirname, "..");
const workflowDir = join(root, ".github", "workflows");
const files = [
  ...readdirSync(workflowDir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => join(".github", "workflows", f)),
  join("setup-action", "action.yml"),
];

const PINNED = /^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}$/;
const TAG_COMMENT = /#\s*v\d+\.\d+\.\d+\s*$/;

/** Every `uses:` in the repository's workflows and composite action, with where it is. */
function usesLines() {
  const out = [];
  for (const file of files) {
    const lines = readFileSync(join(root, file), "utf8").split("\n");
    lines.forEach((line, i) => {
      const m = line.match(/^\s*(?:-\s*)?uses:\s*(\S+)/);
      if (m) out.push({ where: `${file}:${i + 1}`, value: m[1], line });
    });
  }
  return out;
}

test("there are workflow actions to check", () => {
  assert.ok(usesLines().length > 10);
});

test("every third-party action is pinned to a full commit SHA with its tag as a comment", () => {
  const bad = usesLines().filter(
    ({ value, line }) => !value.startsWith("./") && !(PINNED.test(value) && TAG_COMMENT.test(line)),
  );
  assert.deepEqual(
    bad.map((b) => `${b.where}: ${b.line.trim()}`),
    [],
    "pin as `uses: owner/repo@<40-hex sha> # vX.Y.Z`",
  );
});

test("the npm publish job installs without running lifecycle scripts", () => {
  const text = readFileSync(join(workflowDir, "release-cli.yml"), "utf8");
  const start = text.indexOf("\n  npm:\n");
  assert.ok(start > 0, "release-cli.yml has an npm job");
  const rest = text.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[\w-]+:\n/);
  const job = next === -1 ? rest : rest.slice(0, next + 1);
  const installs = job.match(/pnpm install[^\n]*/g) ?? [];
  assert.deepEqual(installs, ["pnpm install --frozen-lockfile --ignore-scripts"]);
});
