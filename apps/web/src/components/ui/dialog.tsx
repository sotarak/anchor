import { Dialog as DialogPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { RiCloseLine } from "react-icons/ri";
import { cn } from "@/lib/cn";
import { overlayMotion, popMotion } from "./motion";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  showClose = true,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { showClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className={cn("fixed inset-0 z-50 bg-black/10", overlayMotion)}
      />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-[28rem] min-w-[320px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2",
          "gap-3 rounded-xl border bg-bg-white p-4 shadow-md outline-none",
          popMotion,
          className,
        )}
        {...props}
      >
        {children}
        {showClose && (
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute top-3 right-3 flex size-6 items-center justify-center rounded-md text-text-soft hover:bg-neutral-alpha-100 hover:text-text-strong"
          >
            <RiCloseLine aria-hidden className="size-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1 pr-6", className)}
      {...props}
    />
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-label-md text-text-strong", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-paragraph-sm text-text-sub", className)}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 mt-3 flex justify-end gap-2 rounded-b-xl border-t bg-bg-weak p-3",
        className,
      )}
      {...props}
    />
  );
}
