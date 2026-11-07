import { DropdownMenu as MenuPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { RiArrowRightSLine, RiCheckLine } from "react-icons/ri";
import { cn } from "@/lib/cn";
import { popMotion } from "./motion";

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuSub = MenuPrimitive.Sub;
export const DropdownMenuGroup = MenuPrimitive.Group;
export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;

const content = `z-50 min-w-40 rounded-lg border bg-bg-white p-1 shadow-md ${popMotion}`;
const item =
  "relative flex select-none items-center gap-2 rounded-md px-2 py-1.5 text-label-sm text-text-sub outline-none " +
  "focus:bg-neutral-alpha-100 focus:text-text-strong data-[disabled]:pointer-events-none data-[disabled]:text-text-disabled [&_svg]:size-4";

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  align = "end",
  ...props
}: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        align={align}
        className={cn(content, className)}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: ComponentProps<typeof MenuPrimitive.Item> & { destructive?: boolean }) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        item,
        destructive && "text-error-base focus:bg-error-lighter focus:text-error-base",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Label>) {
  return (
    <MenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn("flex flex-col px-2 py-1.5", className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-stroke-soft", className)}
      {...props}
    />
  );
}

export function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.SubTrigger>) {
  return (
    <MenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      className={cn(item, "data-[state=open]:bg-neutral-alpha-100", className)}
      {...props}
    >
      {children}
      <RiArrowRightSLine aria-hidden className="ml-auto" />
    </MenuPrimitive.SubTrigger>
  );
}

export function DropdownMenuSubContent({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.SubContent>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.SubContent
        data-slot="dropdown-menu-sub-content"
        className={cn(content, className)}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

/** A single choice inside a DropdownMenuRadioGroup (e.g. a role); the current one is checked. */
export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.RadioItem>) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(item, "pr-8", className)}
      {...props}
    >
      {children}
      <MenuPrimitive.ItemIndicator className="absolute right-2">
        <RiCheckLine aria-hidden />
      </MenuPrimitive.ItemIndicator>
    </MenuPrimitive.RadioItem>
  );
}
