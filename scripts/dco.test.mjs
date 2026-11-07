import assert from "node:assert/strict";
import { test } from "node:test";
import { missingSignOffs } from "./dco.mjs";

const commit = (over = {}) => ({
  sha: "abc1234",
  authorName: "Ada Lovelace",
  authorEmail: "ada@example.com",
  message: "fix: thing\n\nSigned-off-by: Ada Lovelace <ada@example.com>\n",
  parents: 1,
  ...over,
});

test("a commit signed off by its author passes", () => {
  assert.deepEqual(missingSignOffs([commit()]), []);
});

test("a missing sign-off fails", () => {
  assert.deepEqual(missingSignOffs([commit({ message: "fix: thing\n" })]), ["abc1234"]);
});

test("a sign-off naming someone else fails", () => {
  const other = "fix: thing\n\nSigned-off-by: Someone Else <else@example.com>\n";
  assert.deepEqual(missingSignOffs([commit({ message: other })]), ["abc1234"]);
});

test('a lowercase "signed-off-by:" fails', () => {
  const lower = "fix: thing\n\nsigned-off-by: Ada Lovelace <ada@example.com>\n";
  assert.deepEqual(missingSignOffs([commit({ message: lower })]), ["abc1234"]);
});

test("merge commits and bots are skipped", () => {
  assert.deepEqual(
    missingSignOffs([
      commit({ sha: "m1", message: "Merge branch 'main'\n", parents: 2 }),
      commit({
        sha: "b1",
        authorName: "dependabot[bot]",
        authorEmail: "49699333+dependabot[bot]@users.noreply.github.com",
        message: "chore(deps): bump\n",
      }),
    ]),
    [],
  );
});

test("a Co-Authored-By trailer alone does not count", () => {
  const coAuthored = "fix: thing\n\nCo-Authored-By: Ada Lovelace <ada@example.com>\n";
  assert.deepEqual(missingSignOffs([commit({ message: coAuthored })]), ["abc1234"]);
});
