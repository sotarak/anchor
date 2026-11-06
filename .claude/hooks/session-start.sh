#!/usr/bin/env bash
# SessionStart hook: inject the `using-superpowers` bootstrap skill into context.
# Adapted from obra/superpowers hooks/session-start (MIT) for project-local skills.
set -euo pipefail

skill_md="${CLAUDE_PROJECT_DIR:-.}/.claude/skills/using-superpowers/SKILL.md"
content="Error reading using-superpowers skill"
if [ -r "$skill_md" ]; then
  IFS= read -r -d '' content < "$skill_md" || true
fi

esc="$content"
esc="${esc//\\/\\\\}"
esc="${esc//\"/\\\"}"
esc="${esc//$'\n'/\\n}"
esc="${esc//$'\r'/\\r}"
esc="${esc//$'\t'/\\t}"

ctx="<EXTREMELY_IMPORTANT>\nYou have superpowers.\n\n**Below is the full content of your 'using-superpowers' skill - your introduction to using skills. For all other skills, use the 'Skill' tool:**\n\n${esc}\n</EXTREMELY_IMPORTANT>"

trap '' PIPE
printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": "%s"\n  }\n}\n' "$ctx" 2>/dev/null || true
exit 0
