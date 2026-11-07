// Shared motion recipes (tw-animate-css): subtle, 150–200 ms, both ways. The global
// prefers-reduced-motion rule in styles/globals.css turns all of it off.

/** Backdrops behind dialogs and sheets. */
export const overlayMotion =
  "duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0 " +
  "data-[state=closed]:animate-out data-[state=closed]:fade-out-0";

/** Dialogs, popovers, menus and selects: a short fade with a slight zoom. */
export const popMotion =
  "duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 " +
  "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95";

/** Tooltips open as "delayed-open" or "instant-open", never "open". */
export const tooltipMotion =
  "duration-150 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 " +
  "data-[state=instant-open]:animate-in data-[state=instant-open]:fade-in-0 " +
  "data-[state=closed]:animate-out data-[state=closed]:fade-out-0";

/** The right-hand sheet. */
export const sheetMotion =
  "duration-200 data-[state=open]:animate-in data-[state=open]:slide-in-from-right " +
  "data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right";
