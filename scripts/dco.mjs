#!/usr/bin/env node
// Developer Certificate of Origin check: every non-merge, non-bot commit in a range must carry
// `Signed-off-by: <author name> <author email>`, exactly as `git commit -s` writes it.
//
//   node scripts/dco.mjs <base> <head>     # checks base..head, exits 1 when a sign-off is missing
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const BOT_EMAIL = /\[bot\]@users\.noreply\.github\.com$/;

/**
 * @param {{ sha: string, authorName: string, authorEmail: string, message: string, parents: number }[]} commits
 * @returns {string[]} the shas of commits that need a sign-off and lack one
 */
export function missingSignOffs(commits) {
  return commits
    .filter((c) => c.parents <= 1 && !BOT_EMAIL.test(c.authorEmail))
    .filter((c) => {
      const expected = `Signed-off-by: ${c.authorName} <${c.authorEmail}>`;
      return !c.message.split("\n").some((line) => line.trim() === expected);
    })
    .map((c) => c.sha);
}

const FIELD = "\x1f";
const RECORD = "\x1e";

function commitsBetween(base, head) {
  const out = execFileSync(
    "git",
    ["log", `--format=%H${FIELD}%an${FIELD}%ae${FIELD}%P${FIELD}%B${RECORD}`, `${base}..${head}`],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return out
    .split(RECORD)
    .map((r) => r.replace(/^\n/, ""))
    .filter((r) => r.length > 0)
    .map((r) => {
      const [sha, authorName, authorEmail, parents, message] = r.split(FIELD);
      return {
        sha,
        authorName,
        authorEmail,
        message,
        parents: parents.trim() === "" ? 0 : parents.trim().split(/\s+/).length,
      };
    });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [base, head] = process.argv.slice(2);
  if (!base || !head) {
    console.error("usage: node scripts/dco.mjs <base> <head>");
    process.exit(2);
  }
  const missing = missingSignOffs(commitsBetween(base, head));
  if (missing.length === 0) {
    console.log("DCO: every commit is signed off.");
  } else {
    for (const sha of missing) console.error(`DCO: ${sha} has no matching Signed-off-by line.`);
    console.error(
      "Sign off with `git commit -s` (or `git rebase --signoff <base>` for existing commits); see CONTRIBUTING.md.",
    );
    process.exit(1);
  }
}
