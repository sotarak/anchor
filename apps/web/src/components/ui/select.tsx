import { Select as SelectPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { RiArrowDownSLine, RiCheckLine } from "react-icons/ri";
import { cn } from "@/lib/cn";
import { fieldClasses } from "./input";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

export function SelectTrigger({
  className,
  invalid,
  compact,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger> & { invalid?: boolean; compact?: boolean }) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      aria-invalid={invalid || undefined}
      className={cn(
        fieldClasses({ invalid, compact, disabled: props.disabled }),
        "justify-between text-left text-text-strong outline-none data-[placeholder]:text-text-soft",
        compact ? "text-paragraph-xs" : "text-paragraph-sm",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <RiArrowDownSLine aria-hidden className="size-4 shrink-0 text-text-soft" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        className={cn(
          "z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-y-auto rounded-lg border bg-bg-white p-1 shadow-md",
          position === "popper" && "mt-1",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-label-sm text-text-sub outline-none",
        "focus:bg-neutral-alpha-100 focus:text-text-strong data-[disabled]:text-text-disabled",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2">
        <RiCheckLine aria-hidden className="size-4" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}
