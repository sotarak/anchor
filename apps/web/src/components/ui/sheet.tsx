import { Dialog as SheetPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { RiCloseLine } from "react-icons/ri";
import { cn } from "@/lib/cn";
import { overlayMotion, sheetMotion } from "./motion";

// Right-side sheet for create / edit forms. Recipe: components.md (Dialog and Sheet).
export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;

const sheetSizes = {
  default: "sm:max-w-xl",
  // Read-only tables with several columns (version history).
  wide: "sm:max-w-2xl",
} as const;

export function SheetContent({
  className,
  children,
  size = "default",
  ...props
}: ComponentProps<typeof SheetPrimitive.Content> & { size?: keyof typeof sheetSizes }) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay
        data-slot="sheet-overlay"
        className={cn("fixed inset-0 z-50 bg-black/20", overlayMotion)}
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-size={size}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex h-full w-3/4 flex-col border-l bg-bg-white shadow-md outline-none",
          sheetSizes[size],
          sheetMotion,
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close
          aria-label="Close"
          className="absolute top-5 right-5 flex size-6 items-center justify-center rounded-md text-text-soft hover:bg-neutral-alpha-100 hover:text-text-strong"
        >
          <RiCloseLine aria-hidden className="size-4" />
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1 border-b p-6 pr-12", className)}
      {...props}
    />
  );
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-label-md text-text-strong", className)}
      {...props}
    />
  );
}

export function SheetDescription({
  className,
  ...props
}: ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-paragraph-xs text-text-soft", className)}
      {...props}
    />
  );
}

export function SheetBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-body"
      className={cn("flex flex-1 flex-col gap-4 overflow-y-auto p-6", className)}
      {...props}
    />
  );
}

export function SheetFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("flex justify-end gap-2 border-t bg-bg-weak px-6 py-3", className)}
      {...props}
    />
  );
}
