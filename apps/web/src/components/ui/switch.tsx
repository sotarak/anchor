import { Switch as SwitchPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/** On/off setting that applies at once in a form (Sensitive). Announced as a switch. */
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-bg-soft p-0.5 outline-none transition-colors",
        "data-[state=checked]:bg-primary-base focus-visible:shadow-button-primary-focus",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4 rounded-full bg-bg-white shadow-xs transition-transform data-[state=checked]:translate-x-4" />
    </SwitchPrimitive.Root>
  );
}
