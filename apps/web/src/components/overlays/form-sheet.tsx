import type { FormEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/** Create / edit form in a right sheet with a sticky Cancel / submit footer. */
export function FormSheet({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  pending,
  onSubmit,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  submitLabel: string;
  pending: boolean;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <form noValidate onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <SheetBody>{children}</SheetBody>
          <SheetFooter>
            <Button disabled={pending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {submitLabel}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
