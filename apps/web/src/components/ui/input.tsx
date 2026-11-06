import type { ComponentProps, ReactNode } from "react";
import type { IconType } from "react-icons";
import { cn } from "@/lib/cn";

/** The shared field shell (Input, Select trigger); exported for composites that mimic it. */
export function fieldClasses(opts: { invalid?: boolean; compact?: boolean; disabled?: boolean }) {
  return cn(
    "flex w-full items-center gap-2 rounded-lg bg-bg-white px-3 shadow-xs ring-1 ring-inset ring-stroke-soft",
    "hover:bg-bg-weak focus-within:ring-stroke-sub focus-within:shadow-[0_0_0_3px_var(--color-neutral-alpha-100)]",
    opts.compact ? "h-8" : "h-9",
    opts.invalid && "ring-error-base hover:ring-error-base focus-within:ring-error-base",
    opts.disabled && "bg-bg-weak text-text-disabled shadow-none hover:bg-bg-weak",
  );
}

export type InputProps = ComponentProps<"input"> & {
  invalid?: boolean;
  leadingIcon?: IconType;
  compact?: boolean;
  /** Extra controls inside the field, after the input (e.g. a reveal button). */
  trailing?: ReactNode;
};

export function Input({
  invalid,
  leadingIcon: Icon,
  compact,
  trailing,
  className,
  disabled,
  ...props
}: InputProps) {
  return (
    <div data-slot="input" className={cn(fieldClasses({ invalid, compact, disabled }), className)}>
      {Icon && <Icon aria-hidden className="size-4 shrink-0 text-text-soft" />}
      <input
        aria-invalid={invalid || undefined}
        disabled={disabled}
        className={cn(
          "h-full w-full min-w-0 bg-transparent text-text-strong outline-none placeholder:text-text-soft disabled:cursor-not-allowed",
          compact ? "text-paragraph-xs" : "text-paragraph-sm",
        )}
        {...props}
      />
      {trailing}
    </div>
  );
}
