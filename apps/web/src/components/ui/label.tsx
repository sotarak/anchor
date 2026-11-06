import { Label as LabelPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn("text-label-sm text-text-strong", className)}
      {...props}
    />
  );
}

/** Helper text under a field. */
export function FieldHint({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-paragraph-xs text-text-soft", className)} {...props} />;
}

/** Validation message under a field. */
export function FieldError({ className, ...props }: ComponentProps<"p">) {
  return (
    <p role="alert" className={cn("text-paragraph-xs text-error-base", className)} {...props} />
  );
}
