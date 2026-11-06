import { Checkbox as CheckboxPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { RiCheckLine } from "react-icons/ri";
import { cn } from "@/lib/cn";

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-4 bg-bg-white shadow-xs ring-1 ring-inset ring-stroke-sub outline-none",
        "data-[state=checked]:bg-primary-base data-[state=checked]:ring-primary-base data-[state=checked]:text-white",
        "focus-visible:shadow-button-primary-focus disabled:bg-bg-weak disabled:ring-stroke-soft",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <RiCheckLine aria-hidden className="size-3" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
