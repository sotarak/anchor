---
name: dashboard-ui
description: Use when building, styling, or reviewing any screen, component, or layout of the Anchor web dashboard (React, Tailwind, shadcn/ui) — pages, tables, forms, dialogs, sheets, sidebar, header, empty/loading states, badges, or when the request mentions "clean", "compact", "Novu-like", design tokens, or visual consistency.
---

# Anchor Dashboard UI (Novu-style)

## Overview

The Anchor dashboard looks and behaves like the **Novu dashboard**: a calm, light, dense admin UI.
Near-white surfaces, cool-gray text in three strengths, hairline translucent borders, almost no
shadow, one crimson brand color reserved for the primary action, and tinted status pills.

**Core principle:** every visual value comes from a named token, and every repeated look lives in a
primitive's variant. Call sites compose primitives; they do not restyle them.

## Setup (once per dashboard)

1. Copy [tokens.css](tokens.css) into the dashboard's global stylesheet. It defines the semantic
   utilities below and re-points shadcn's variables (`--color-primary`, `--color-border`, ...) so stock
   shadcn components already match.
2. Load Inter (UI) and JetBrains Mono (keys, values, IDs) via `@fontsource`.
3. Icons: `react-icons/ri` (Remix, the set Novu uses) at `size-4` in nav/buttons, `size-3.5` inline.
   Use one icon set across the app.
4. Restyle the shadcn primitives once, following [components.md](components.md). Size and color
   variants live there, not at call sites.

## The token vocabulary

| Need | Use |
|---|---|
| Page / card / table surface | `bg-bg-white` |
| Sidebar, table header, dialog footer, disabled field | `bg-bg-weak` (sidebar: `bg-neutral-alpha-50`) |
| Hover / selected fill | `bg-neutral-alpha-100` |
| Primary text, headings, cell values | `text-text-strong` |
| Secondary text, column headers, nav items | `text-text-sub` |
| Meta, placeholders, group labels, icons | `text-text-soft` |
| Every border and divider | default border color (`border`), or `ring-stroke-soft` on inputs |
| Brand action | `bg-primary-base hover:bg-primary-darker text-white` |
| Status | `bg-{success,warning,error,information,feature,faded}-lighter text-…-base` |

Type scale (font weight is built into the token, so no `font-medium` next to it):

| Token | Size | Where |
|---|---|---|
| `text-label-md` | 16px/500 | Header page title, dialog/sheet title |
| `text-label-sm` | 14px/500 | Nav items, buttons, table cells (primary column), form labels |
| `text-paragraph-sm` | 14px/400 | Body copy, table cells (other columns), input text |
| `text-label-xs` | 12px/500 | Badges, tags, small buttons, column meta |
| `text-paragraph-xs` | 12px/400 | Helper text, descriptions, timestamps under names |
| `text-code-xs` | 12px mono | Secret keys under names, slugs, IDs, paths, masked values |
| `text-label-2xs` | 10px/400 | Avatar initials, counters inside tiny pills |

Radius: `rounded-lg` (8px) for buttons, inputs, nav items, table container; `rounded-md` (6px) for
badges and tags; `rounded-xl` (12px) for cards, dialogs, popovers. Shadow: `shadow-xs` on tables and
inputs, `shadow-md` on dialogs, sheets and popovers only.

## Page anatomy

Every authenticated page uses the same shell. Build it as `AppShell` once and reuse it.

```
┌ Sidebar 275px, bg-neutral-alpha-50, no border ─┬ Header h-12, bg-bg-white, border-b ─────────────┐
│ Org row: logo tile + org name (label-md)        │ Page title (label-md)     ⌘K · Help · Bell · Me │
│ Environment switcher card (white, ring, xs shd) ├─────────────────────────────────────────────────┤
│ Group label  ▾  (text-soft, sentence case)      │ Content: p-3, full width, flex-col gap-4        │
│   ◦ Nav item (label-sm, text-sub, py-1.5 px-2)  │  Toolbar: dashed filter chips ……… Primary CTA   │
│   ● Selected (text-strong, bg-neutral-alpha-100)│  Section label (paragraph-sm text-soft)         │
│ …                                               │  Table (rounded-lg border shadow-xs)            │
│ Settings pinned to bottom (mt-auto)             │  Footer row: "N results" · pager · page size    │
└─────────────────────────────────────────────────┴─────────────────────────────────────────────────┘
```

- **Page title lives in the header bar**, not in the content. The content starts directly with the
  toolbar. Use an in-content heading only for a section label (`text-paragraph-sm text-text-soft`,
  e.g. "Your secrets").
- **Content is full width** with `p-3`. Detail and settings forms can cap at `max-w-3xl`; list pages
  never get a centered `max-w-*` container.
- **Toolbar:** left = filter chips (`Button` variant `dashed`, size `xs`: `⊕ Search`, `⊕ Path`,
  `⊕ Status`), right = one primary button, optionally split with a `▾` for secondary create options.
  The Search chip turns into an inline `h-8` input on click (autofocus, `/` shortcut); facet chips
  open a popover with a checkbox list and, when active, show their value and a clear `×`. Other
  actions go in the row `⋮` menu.
- **Density:** the values in this skill *are* the compact target ("clean, compact, like Novu"). Do
  not shrink cells, fonts or the sidebar further.
- **Environment = Novu's "Development" card**: the first block of the sidebar is a switcher card
  showing the current environment with a colored icon tile. Switching environment is global.

## Lists and tables

- Container: `rounded-lg border shadow-xs overflow-hidden`. Header row `bg-bg-weak h-10`,
  header cells `text-label-sm text-text-sub` in **sentence case**, sortable headers get a small
  `↕` icon (`RiExpandUpDownLine size-3.5`).
- Cells `px-6 py-3`; rows separated by bottom borders, `hover:bg-bg-weak`, whole row clickable when it
  opens a detail.
- Primary column = name (`text-label-sm text-text-strong`) with a `size-4 text-text-soft` type icon
  on the left. If the identifier (slug, path, ID) has no column of its own, show it as a second line
  in `text-code-xs text-text-soft`; if it has its own column, the primary cell is one line.
- Row actions (`⋮`, reveal, copy) sit in the last cell with `onClick={e => e.stopPropagation()}`
  when the row itself is clickable. Hover-revealed actions use `opacity-0 group-hover:opacity-100
  group-focus-within:opacity-100` on a `group` row, and stay visible on touch (`pointer-coarse:opacity-100`).
- People ("updated by"): `size-5 rounded-full bg-bg-soft text-label-2xs text-text-sub` initials circle
  + name in `text-paragraph-sm text-text-sub`.
- Empty values show `–` in `text-text-soft`. Dates are absolute (`Apr 2, 2026`) with relative time in a
  tooltip. Row actions: a ghost icon button `⋮` aligned right.
- Footer inside the container: `N results` left (`text-paragraph-sm text-text-sub`), prev/next
  segmented buttons center, `10 / page` select right.
- Loading = skeleton rows with the same column widths (`h-5 w-[14ch] animate-pulse rounded-full
  bg-neutral-alpha-100`). Empty = a
  centered block (icon tile, `text-label-md` title, `text-paragraph-sm text-text-soft` one-liner,
  primary button + secondary link). Filtered-empty says what to clear.

## Status, tags, values

- **Status badge** = tinted pill: `h-6 rounded-md px-2 text-label-xs` + `bg-<state>-lighter
  text-<state>-base` + leading filled icon (`RiCheckboxCircleFill` / `RiErrorWarningFill` /
  `RiForbidFill`) or a `size-1.5` dot. Map: active→success, expiring→warning, expired/revoked→faded,
  failed→error, info→information.
- **Tag** = `h-6 rounded-md px-2 text-label-xs bg-feature-lighter text-feature-base` (Novu's purple
  tags), several in a row with `gap-1`.
- **Secret values** are masked by default (`••••••••` in `text-code-xs`), reveal and copy are ghost
  icon buttons shown on row hover; copy shows a check for 1.5s and a toast "Copied".

## Overlays and forms

- **Create / edit** = right `Sheet` (`sm:max-w-xl`), header `p-6` with `text-label-md` title and
  `text-paragraph-xs text-text-soft` description, body `p-6 flex-col gap-4`, sticky footer
  `border-t bg-bg-weak px-6 py-3` with secondary then primary button, right aligned.
- **Confirm / one-time reveal** = centered `Dialog` (`rounded-xl p-4 shadow-md`), footer flush to the
  edges: `-mx-4 -mb-4 mt-3 rounded-b-xl border-t bg-bg-weak p-3 justify-end gap-2`. Destructive
  confirm uses the `error` button variant and names the object ("Revoke token `ci-deploy`").
- Fields: label `text-label-sm text-text-strong`, input `h-9 rounded-lg ring-1 ring-stroke-soft
  shadow-xs text-paragraph-sm`, hint `text-paragraph-xs text-text-soft`, error text `text-error-base`.
  Group with `gap-4`; never put a form in a bordered card inside a sheet.
- Feedback: `sonner` toasts bottom-right, one line. Tooltips dark (`bg-bg-strong text-white
  text-paragraph-xs rounded-md px-2 py-1`).

## Before you finish a UI change

Run this checklist against the diff and fix every miss:

1. Every color class is a token from the vocabulary table (`grep -E '(slate|zinc|gray|emerald|amber|red|blue)-[0-9]'` finds nothing).
2. Every text size is a `label-*`, `paragraph-*`, `code-*` or `subheading-*` token (`grep 'text-\['` finds nothing).
3. Header cells and group labels are sentence case (no `uppercase`).
4. Buttons, inputs and badges use primitive variants; no `h-8 text-…` overrides at call sites.
5. The brand color appears only on the page's primary action, focus rings and selected states.
6. Page title is in the header; list content is full width; table has the footer row.
7. Loading, empty and filtered-empty states exist for every list.
8. No secret value is rendered unmasked without an explicit reveal.

## Common mistakes

| You wrote | Write instead |
|---|---|
| `text-[13px]`, `text-[11px]`, `text-xs font-medium` | `text-label-sm` / `text-paragraph-xs` / `text-label-xs` |
| `uppercase tracking-wide` table headers or nav groups | sentence case, `text-label-sm text-text-sub` / `text-text-soft` |
| `bg-emerald-500` dot, outline badge | `StatusBadge status="active"` (tinted pill) |
| `text-muted-foreground` everywhere | pick `text-text-sub` (secondary) or `text-text-soft` (tertiary) |
| `<h1>` above the table | title in the header bar, section label above the table |
| `mx-auto max-w-6xl` list container | full width, `p-3` |
| Search `<Input>` + `<Select>` toolbar | dashed filter chips that open popovers |
| `border-r` sidebar with `w-52` | `w-[275px] bg-neutral-alpha-50`, no border |
| Black default shadcn primary | brand `primary` via tokens.css |
| `Card` with `p-6` around every section | flat sections; cards only for templates, stats and empty states |
