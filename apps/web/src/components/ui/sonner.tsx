// sonner's base layout as a real stylesheet: its runtime <style> injection is blocked by the CSP
// and disabled in scripts/vite-plugin-csp-styles.ts.
import "sonner/dist/styles.css";
import { Toaster as Sonner } from "sonner";

/** One-line toasts, bottom-right, styled with tokens (no sonner default palette). */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-full items-center gap-2 rounded-lg border bg-bg-white px-3 py-2 text-paragraph-sm text-text-strong shadow-md [&_svg]:size-4",
          error: "[&_svg]:text-error-base",
          success: "[&_svg]:text-success-base",
          description: "text-paragraph-xs text-text-sub",
        },
      }}
    />
  );
}
