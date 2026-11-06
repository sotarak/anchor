import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export function Textarea({
  invalid,
  mono,
  className,
  ...props
}: ComponentProps<"textarea"> & { invalid?: boolean; mono?: boolean }) {
  return (
    <textarea
      data-slot="textarea"
      aria-invalid={invalid || undefined}
      className={cn(
        "min-h-20 w-full rounded-lg bg-bg-white px-3 py-2 text-text-strong shadow-xs outline-none ring-1 ring-inset ring-stroke-soft",
        "placeholder:text-text-soft hover:bg-bg-weak focus:ring-stroke-sub focus:shadow-[0_0_0_3px_var(--color-neutral-alpha-100)]",
        "disabled:bg-bg-weak disabled:text-text-disabled disabled:shadow-none",
        mono ? "text-code-xs" : "text-paragraph-sm",
        invalid && "ring-error-base hover:ring-error-base focus:ring-error-base",
        className,
      )}
      {...props}
    />
  );
}
