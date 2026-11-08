import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/** A segmented choice between a few options (a boolean value). */
export function ToggleGroup({
  className,
  ...props
}: ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn("inline-flex gap-0.5 rounded-lg bg-bg-weak p-0.5", className)}
      {...props}
    />
  );
}

export function ToggleGroupItem({
  className,
  ...props
}: ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        "h-8 rounded-lg px-3 text-label-sm text-text-sub outline-none transition-colors",
        "hover:text-text-strong focus-visible:shadow-button-primary-focus",
        "data-[state=on]:bg-bg-white data-[state=on]:text-text-strong data-[state=on]:shadow-xs",
        className,
      )}
      {...props}
    />
  );
}
