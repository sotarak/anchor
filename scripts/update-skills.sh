#!/usr/bin/env bash
# Re-vendor third-party skills into .claude/skills. Review `git diff` afterwards.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/.claude/skills"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

CF_SKILLS=(cloudflare workers-best-practices wrangler cf-cli durable-objects workers-profiling)

git clone --quiet --depth 1 https://github.com/obra/superpowers.git "$TMP/superpowers"
git clone --quiet --depth 1 https://github.com/cloudflare/skills.git "$TMP/cf"

for dir in "$TMP"/superpowers/skills/*; do
  name="$(basename "$dir")"
  rm -rf "${DEST:?}/$name"
  cp -R "$dir" "$DEST/$name"
  { grep -rl 'superpowers:[a-z]' "$DEST/$name" 2>/dev/null || true; } \
    | xargs -r sed -i.bak -E 's/superpowers:([a-z])/\1/g'
  find "$DEST/$name" -name '*.bak' -delete
done

for name in "${CF_SKILLS[@]}"; do
  rm -rf "${DEST:?}/$name"
  cp -R "$TMP/cf/skills/$name" "$DEST/$name"
done

echo "superpowers: $(git -C "$TMP/superpowers" rev-parse HEAD)"
echo "cloudflare:  $(git -C "$TMP/cf" rev-parse HEAD)"
echo "Update the commit hashes in .claude/VENDORED.md, then review: git diff --stat .claude/skills"
