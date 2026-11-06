import { cn } from "@/lib/cn";

const WIDTHS = { "8ch": "w-[8ch]", "14ch": "w-[14ch]", "24ch": "w-[24ch]" } as const;

export function Skeleton({ width = "14ch" }: { width?: keyof typeof WIDTHS }) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn("h-5 animate-pulse rounded-full bg-neutral-alpha-100", WIDTHS[width])}
    />
  );
}
