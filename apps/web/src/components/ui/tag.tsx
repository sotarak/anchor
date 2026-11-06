import { cva } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

const tag = cva("inline-flex items-center whitespace-nowrap rounded-md", {
  variants: {
    tone: {
      feature: "h-6 gap-1 px-2 text-label-xs bg-feature-lighter text-feature-base",
      // Key / path chip.
      neutral:
        "h-5 bg-bg-weak px-1.5 text-code-xs text-text-sub ring-1 ring-inset ring-stroke-soft",
    },
  },
  defaultVariants: { tone: "feature" },
});

export function Tag({
  tone,
  className,
  ...props
}: ComponentProps<"span"> & { tone?: "feature" | "neutral" }) {
  return <span data-slot="tag" className={cn(tag({ tone }), className)} {...props} />;
}
