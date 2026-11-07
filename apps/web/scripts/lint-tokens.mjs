#!/usr/bin/env node
// Fails on raw Tailwind palette colors, arbitrary text sizes, `uppercase`, `cursor-default` and
// middle-dot separators in dashboard source.
// Colors and sizes must come from the dashboard-ui tokens (see .claude/skills/dashboard-ui).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const RULES = [
  {
    re: /\b(?:bg|text|border|ring|fill|stroke)-(?:slate|zinc|gray|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
    why: "raw palette color (use a token)",
  },
  { re: /text-\[/, why: "arbitrary text size (use a text-* token)" },
  { re: /\buppercase\b/, why: "uppercase (sentence case only)" },
  {
    re: /\bcursor-default\b/,
    why: "cursor-default (base styles give interactive elements a pointer)",
  },
  { re: /·/, why: "middle dot (use layout, a breadcrumb or words)" },
];
const EXCLUDED = `styles${sep}globals.css`;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.(tsx|css)$/.test(entry.name)) yield path;
  }
}

const root = process.argv[2] ?? "src";
let hits = 0;
for (const file of walk(root)) {
  const rel = relative(root, file);
  if (rel === EXCLUDED) continue;
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      for (const { re, why } of RULES) {
        if (re.test(line)) {
          hits++;
          console.log(`${rel}:${i + 1}: ${why}: ${line.trim()}`);
        }
      }
    });
}
if (hits > 0) {
  console.log(`\n${hits} token violation(s)`);
  process.exit(1);
}
