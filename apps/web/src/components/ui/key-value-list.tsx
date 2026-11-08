import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type KeyValueItem = { label: string; value: ReactNode; mono?: boolean };

/**
 * Label/value rows on a shared baseline (approval pages: device, IP, app, redirect host). Values
 * wrap instead of widening the card, so a long device name stays inside a phone-width screen.
 */
export function KeyValueList({ items, className }: { items: KeyValueItem[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2", className)}>
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-paragraph-sm text-text-soft">{item.label}</dt>
          <dd
            className={cn(
              "min-w-0 break-words text-paragraph-sm text-text-strong",
              item.mono && "font-mono",
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
