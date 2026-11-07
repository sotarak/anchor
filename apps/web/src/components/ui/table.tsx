import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

// Recipe: .claude/skills/dashboard-ui/components.md (Table).
export function TableContainer({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="table-container"
      className={cn("relative w-full overflow-x-auto rounded-lg border shadow-xs", className)}
      {...props}
    />
  );
}

export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <table
      data-slot="table"
      className={cn("w-full border-separate border-spacing-0 text-paragraph-sm", className)}
      {...props}
    />
  );
}

export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("sticky top-0 z-10 bg-bg-weak", className)}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      // Rows fade in when they mount (data replacing the skeleton, a new page); a refetch
      // keeps row keys, so existing rows do not flash.
      className={cn("[&>tr]:animate-in [&>tr]:fade-in-0 [&>tr]:duration-200", className)}
      {...props}
    />
  );
}

export function TableRow({
  className,
  clickable,
  ...props
}: ComponentProps<"tr"> & { clickable?: boolean }) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "group transition-colors duration-150 [&>td]:border-b last:[&>td]:border-0",
        clickable && "cursor-pointer hover:bg-bg-weak",
        !clickable && "hover:bg-bg-weak",
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 whitespace-nowrap px-6 text-left align-middle text-label-sm text-text-sub",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  primary,
  ...props
}: ComponentProps<"td"> & { primary?: boolean }) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-6 py-3 align-middle",
        primary ? "text-label-sm text-text-strong" : "text-text-sub",
        className,
      )}
      {...props}
    />
  );
}
