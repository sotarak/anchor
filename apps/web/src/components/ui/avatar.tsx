import { cn } from "@/lib/cn";

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
  return letters.map((p) => p?.[0]?.toUpperCase() ?? "").join("") || "?";
}

/** Initials circle for a person. */
export function Avatar({ name, size = "sm" }: { name: string; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-bg-soft text-text-sub",
        size === "sm" ? "size-5 text-label-2xs" : "size-7 text-label-xs",
      )}
    >
      {initials(name)}
    </span>
  );
}
