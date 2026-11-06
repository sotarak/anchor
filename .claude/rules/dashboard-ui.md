---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/*.css"
  - "**/components.json"
---

# Dashboard UI rules

The Anchor dashboard follows the Novu dashboard style. Load the `dashboard-ui` skill before writing or
reviewing any dashboard screen, component or stylesheet, and run its "Before you finish a UI change"
checklist on every UI diff.

- Colors, text sizes, radii and shadows come only from the tokens in
  `.claude/skills/dashboard-ui/tokens.css` (`bg-bg-weak`, `text-text-sub`, `text-label-sm`, ...).
- Repeated looks live in primitive variants (`components/ui/*`); call sites pass `variant`/`size`.
- Every list has loading, empty and filtered-empty states.
- Secret values render masked until the user explicitly reveals them.
