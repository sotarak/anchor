import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

// Recipe: .claude/skills/dashboard-ui/components.md (Button).
export const buttonVariants = cva(
  "group relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap " +
    "transition duration-200 ease-out outline-none disabled:pointer-events-none " +
    "disabled:bg-bg-weak disabled:text-text-disabled disabled:ring-transparent [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-primary-base text-white hover:bg-primary-darker focus-visible:shadow-button-primary-focus",
        secondary:
          "bg-bg-white text-text-sub ring-1 ring-inset ring-stroke-soft shadow-xs hover:bg-bg-weak hover:text-text-strong",
        ghost: "bg-transparent text-text-sub hover:bg-neutral-alpha-100 hover:text-text-strong",
        dashed:
          "border border-dashed border-stroke-soft bg-transparent text-text-sub hover:bg-bg-weak hover:text-text-strong",
        error:
          "bg-error-base text-white hover:bg-error-base/90 focus-visible:shadow-button-error-focus",
        "error-ghost": "bg-transparent text-error-base hover:bg-error-lighter",
      },
      size: {
        md: "h-10 rounded-10 px-3.5 text-label-sm",
        sm: "h-9 rounded-lg px-3 text-label-sm",
        xs: "h-8 rounded-lg px-3 text-label-xs [&_svg]:size-3.5",
        "2xs": "h-7 rounded-lg px-2 text-label-xs [&_svg]:size-3.5",
        icon: "size-8 rounded-lg",
        "icon-xs": "size-6 rounded-md [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "secondary", size: "xs" },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
