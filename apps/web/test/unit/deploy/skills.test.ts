// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PRIVATE_KEY, SECRET_LIKE } from "../../support/secret-like";

const path = (rel: string) => fileURLToPath(new URL(`../../../../../${rel}`, import.meta.url));
const read = (rel: string) => readFileSync(path(rel), "utf8");

function filesUnder(rel: string): string[] {
  if (!existsSync(path(rel))) return [];
  return readdirSync(path(rel)).flatMap((name) => {
    const child = `${rel}/${name}`;
    return statSync(path(child)).isDirectory() ? filesUnder(child) : [child];
  });
}

const skillDirs = () =>
  existsSync(path("skills"))
    ? readdirSync(path("skills")).filter((d) => statSync(path(`skills/${d}`)).isDirectory())
    : [];

/** Top-level `key: value` pairs of the YAML frontmatter, plus the keys nested under `metadata:`. */
function frontmatter(rel: string): { fields: Record<string, string>; metadataKeys: string[] } {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(read(rel));
  expect(match, `${rel} starts with YAML frontmatter`).not.toBeNull();
  const fields: Record<string, string> = {};
  const metadataKeys: string[] = [];
  let inMetadata = false;
  for (const line of (match?.[1] ?? "").split("\n")) {
    const top = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (top?.[1]) {
      inMetadata = top[1] === "metadata";
      fields[top[1]] = (top[2] ?? "").replace(/^(["'])(.*)\1$/, "$2");
      continue;
    }
    const nested = /^\s+([A-Za-z-]+):/.exec(line);
    if (inMetadata && nested?.[1]) metadataKeys.push(nested[1]);
  }
  return { fields, metadataKeys };
}

describe("agent skills (npx skills add sotarak/anchor)", () => {
  it("ships exactly the user-facing skills", () => {
    expect(skillDirs().sort()).toEqual(["anchor-cli", "anchor-migrate"]);
  });

  it("every skill has a valid name and a when-to-use description", () => {
    for (const dir of skillDirs()) {
      const { fields, metadataKeys } = frontmatter(`skills/${dir}/SKILL.md`);
      expect(fields.name, dir).toBe(dir);
      expect(dir).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(fields.description, dir).toMatch(/^Use when /);
      expect(fields.description?.length, dir).toBeLessThanOrEqual(1024);
      expect(metadataKeys, dir).not.toContain("internal");
    }
  });

  it("no skill file holds a secret-looking string", () => {
    for (const file of filesUnder("skills")) {
      const text = read(file);
      expect(text, file).not.toMatch(SECRET_LIKE);
      expect(text, file).not.toMatch(PRIVATE_KEY);
      expect(text, file).not.toMatch(/sk_(live|test)_[A-Za-z0-9]{16,}/);
    }
  });
});
