# Primitive recipes

Restyle the shadcn/ui primitives in `src/components/ui/*` with these classes once. Call sites pass
`variant` / `size` / `status` props only. Class strings are adapted from Novu's dashboard primitives.

## Button

```tsx
import { cva, type VariantProps } from "class-variance-authority";

export const buttonVariants = cva(
  "group relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap " +
    "transition duration-200 ease-out outline-none disabled:pointer-events-none " +
    "disabled:bg-bg-weak disabled:text-text-disabled disabled:ring-transparent [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // The one brand action per page.
        primary:
          "bg-primary-base text-white hover:bg-primary-darker focus-visible:shadow-button-primary-focus",
        // Everything else: white with a hairline ring.
        secondary:
          "bg-bg-white text-text-sub ring-1 ring-inset ring-stroke-soft shadow-xs hover:bg-bg-weak hover:text-text-strong",
        ghost: "bg-transparent text-text-sub hover:bg-neutral-alpha-100 hover:text-text-strong",
        // Filter chips: "⊕ Search", "⊕ Status".
        dashed:
          "border border-dashed border-stroke-soft bg-transparent text-text-sub hover:bg-bg-weak hover:text-text-strong",
        error: "bg-error-base text-white hover:bg-error-base/90 focus-visible:shadow-button-error-focus",
        "error-ghost": "bg-transparent text-error-base hover:bg-error-lighter",
      },
      size: {
        md: "h-10 rounded-10 px-3.5 text-label-sm",
        sm: "h-9 rounded-lg px-3 text-label-sm",
        xs: "h-8 rounded-lg px-3 text-label-xs [&_svg]:size-3.5",
        "2xs": "h-7 rounded-lg px-2 text-label-xs [&_svg]:size-3.5",
        icon: "size-8 rounded-lg",
        "icon-xs": "size-6 rounded-md [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "secondary", size: "xs" },
  },
);
export type ButtonProps = VariantProps<typeof buttonVariants>;
```

Size guide: page primary CTA `sm`; toolbar chips and header buttons `xs`; dialog/sheet footer `xs`;
row icon actions `icon-xs`. Split button: wrap a primary `sm` button and a primary `icon` button with
`▾` in `inline-flex [&>*:first-child]:rounded-r-none [&>*:last-child]:rounded-l-none
[&>*:last-child]:border-l [&>*:last-child]:border-white/20`.

## StatusBadge and Tag

```tsx
const statusBadge = cva("inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-label-xs [&_svg]:size-4", {
  variants: {
    status: {
      success: "bg-success-lighter text-success-base",
      warning: "bg-warning-lighter text-warning-base",
      error: "bg-error-lighter text-error-base",
      info: "bg-information-lighter text-information-base",
      neutral: "bg-faded-lighter text-text-sub",
    },
  },
  defaultVariants: { status: "neutral" },
});

// Icons: success RiCheckboxCircleFill, warning RiErrorWarningFill, error RiCloseCircleFill,
// neutral RiForbidFill. A `before:size-1.5 before:rounded-full before:bg-current` dot is the compact form.
```

Map domain states to `status` in one place (e.g. `tokenStatus(t) → "success" | "warning" | "neutral"`).

Tag: `inline-flex h-6 items-center gap-1 rounded-md px-2 text-label-xs bg-feature-lighter text-feature-base`.
Path / key chip: `inline-flex h-5 items-center rounded-md bg-bg-weak px-1.5 text-code-xs text-text-sub ring-1 ring-inset ring-stroke-soft`.
Keyboard hint (`⌘K`): `rounded-4 bg-bg-weak px-1 text-label-xs text-text-soft ring-1 ring-inset ring-stroke-soft`.

## Input, Select, Textarea

- Wrapper: `flex h-9 w-full items-center gap-2 rounded-lg bg-bg-white px-3 shadow-xs ring-1 ring-inset ring-stroke-soft`
  `hover:bg-bg-weak focus-within:ring-stroke-sub focus-within:shadow-[0_0_0_3px_var(--color-neutral-alpha-100)]`.
- Text: `text-paragraph-sm text-text-strong placeholder:text-text-soft`. Leading icon `size-4 text-text-soft`.
- Invalid: `ring-error-base`, message `text-paragraph-xs text-error-base` below.
- Disabled: `bg-bg-weak text-text-disabled shadow-none`.
- Compact (in toolbars, tables): `h-8 text-paragraph-xs`.
- Secret value input: `font-mono text-code-xs`, `type="password"` with a reveal ghost icon button.

## Table

| Part | Classes |
|---|---|
| Container | `relative w-full overflow-x-auto rounded-lg border shadow-xs` |
| `<table>` | `w-full border-separate border-spacing-0 text-paragraph-sm` |
| `<thead>` row | `sticky top-0 z-10 bg-bg-weak` |
| `<th>` | `h-10 px-6 text-left align-middle text-label-sm text-text-sub` (sentence case) |
| `<tr>` body | `hover:bg-bg-weak [&>td]:border-b last:[&>td]:border-0 cursor-pointer` |
| `<td>` | `px-6 py-3 align-middle text-text-sub` (primary column `text-text-strong`) |
| Footer | `flex items-center justify-between border-t px-4 py-3` |
| Pager | two `secondary icon` buttons joined (`rounded-r-none` / `rounded-l-none -ml-px`); disabled keeps the ring: `disabled:bg-bg-white disabled:ring-stroke-soft disabled:text-text-disabled` |

Primary cell:

```tsx
<td className="px-6 py-3">
  <div className="flex items-center gap-2.5">
    <RiKey2Line className="size-4 shrink-0 text-text-soft" />
    <div className="flex min-w-0 flex-col">
      <span className="truncate text-label-sm text-text-strong">{secret.key}</span>
      <span className="truncate text-code-xs text-text-soft">{secret.path}</span>
    </div>
  </div>
</td>
```

## App shell

- Root: `flex h-dvh w-full bg-bg-white`.
- Sidebar: `hidden md:flex w-[275px] shrink-0 flex-col gap-4 bg-neutral-alpha-50 px-3 py-3 overflow-y-auto`.
  - Org row: `flex items-center gap-2.5 px-2 py-1.5` → `size-7 rounded-full` logo tile + `text-label-md text-text-strong`.
  - Environment card: `flex w-full items-center gap-2.5 rounded-lg bg-bg-white px-2.5 py-2 shadow-xs ring-1 ring-inset ring-stroke-soft`
    with a `size-7 rounded-md bg-warning-lighter text-warning-base` icon tile and `text-label-md` name, chevron right.
  - Group trigger: `group flex w-full items-center gap-1 px-2 py-1 text-paragraph-sm text-text-soft` + `RiArrowRightSLine size-3.5 group-data-[state=open]:rotate-90 transition-transform`.
  - Nav link: `flex items-center gap-2 rounded-lg px-2 py-1.5 text-label-sm text-text-sub transition hover:bg-neutral-alpha-100`
    selected `bg-neutral-alpha-100 text-text-strong`. Icon `size-4`.
    With TanStack Router: `<Link to=… className={navLink} activeProps={{ className: "bg-neutral-alpha-100 text-text-strong" }}>`.
  - Last group (`Settings`) pinned with `mt-auto`.
- Header: `flex h-12 shrink-0 items-center justify-between border-b bg-bg-white px-4` → title
  `text-label-md text-text-strong`; right cluster `flex items-center gap-2` of `secondary xs` buttons, a
  `h-4 w-px bg-stroke-soft` divider, ghost bell icon, `size-8 rounded-full` avatar.
- Content: `flex flex-1 flex-col gap-4 overflow-y-auto p-3`.

## Dialog and Sheet

- Overlay: `fixed inset-0 z-50 bg-black/10` (dialog) / `bg-black/20` (sheet).
- Dialog content: `grid min-w-[320px] max-w-[calc(100vw-2rem)] gap-3 rounded-xl border bg-bg-white p-4 shadow-md`;
  title `text-label-md text-text-strong`; description `text-paragraph-sm text-text-sub`;
  footer `-mx-4 -mb-4 mt-3 flex justify-end gap-2 rounded-b-xl border-t bg-bg-weak p-3`.
- Sheet content (right): `fixed inset-y-0 right-0 flex h-full w-3/4 flex-col border-l bg-bg-white shadow-md sm:max-w-xl`;
  header `flex flex-col gap-1 border-b p-6`; body `flex flex-1 flex-col gap-4 overflow-y-auto p-6`;
  footer `flex justify-end gap-2 border-t bg-bg-weak px-6 py-3`.
- One-time secret reveal: dialog with `onInteractOutside={e => e.preventDefault()}`, the value in a
  `rounded-lg bg-bg-weak px-3 py-2 text-code-xs ring-1 ring-inset ring-stroke-soft` box with a copy
  button, and a `bg-warning-lighter text-warning-base rounded-lg p-3 text-paragraph-xs` notice.

## Menus, popovers, tooltips

- Dropdown content: `min-w-40 rounded-lg border bg-bg-white p-1 shadow-md`; item
  `flex items-center gap-2 rounded-md px-2 py-1.5 text-label-sm text-text-sub focus:bg-neutral-alpha-100 focus:text-text-strong [&_svg]:size-4`;
  destructive item `text-error-base focus:bg-error-lighter focus:text-error-base`; separator `-mx-1 my-1 h-px bg-stroke-soft`.
- Popover: `w-72 rounded-xl border bg-bg-white p-3 shadow-md`.
- Tooltip: `rounded-md bg-bg-strong px-2 py-1 text-paragraph-xs text-white`.

## Empty state

```tsx
<div className="flex flex-1 flex-col items-center justify-center gap-6 py-16 text-center">
  <div className="flex size-12 items-center justify-center rounded-xl bg-bg-weak ring-1 ring-inset ring-stroke-soft">
    <RiKey2Line className="size-6 text-text-soft" />
  </div>
  <div className="flex flex-col gap-1">
    <h3 className="text-label-md text-text-strong">No secrets in Production yet</h3>
    <p className="max-w-[60ch] text-paragraph-sm text-text-soft">
      Add a secret here or import a .env file. Values are encrypted before they are stored.
    </p>
  </div>
  <div className="flex items-center gap-3">
    <Button variant="primary" size="sm"><RiAddLine /> Add secret</Button>
    <Button variant="ghost" size="sm">Import .env</Button>
  </div>
</div>
```

## Template / quick-start cards (Novu "Start with")

`group flex flex-col gap-3 rounded-xl border bg-bg-white p-3 shadow-xs transition hover:shadow-sm`;
preview area `h-36 rounded-lg bg-bg-weak bg-[radial-gradient(var(--color-neutral-alpha-200)_1px,transparent_1px)] [background-size:12px_12px]`;
title `text-label-sm text-text-strong`; description `text-paragraph-xs text-text-sub line-clamp-1`.
Use for onboarding (e.g. "Import .env", "Connect CI") on first-run pages only.
