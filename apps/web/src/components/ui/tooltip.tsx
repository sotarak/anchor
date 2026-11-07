import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { tooltipMotion } from "./motion";

export const TooltipProvider = TooltipPrimitive.Provider;
export const TooltipRoot = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 rounded-md bg-bg-strong px-2 py-1 text-paragraph-xs text-white",
          tooltipMotion,
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

/** Wraps one focusable/hoverable child with a dark tooltip. */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipContent>{content}</TooltipContent>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
