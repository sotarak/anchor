import type { ReactNode } from "react";
import { RiErrorWarningFill, RiInformationFill } from "react-icons/ri";
import { cn } from "@/lib/cn";

const TONES = {
  error: { box: "bg-error-lighter text-error-base", Icon: RiErrorWarningFill },
  warning: { box: "bg-warning-lighter text-warning-base", Icon: RiErrorWarningFill },
  information: { box: "bg-information-lighter text-information-base", Icon: RiInformationFill },
} as const;

const SIZES = {
  md: { box: "gap-2 p-3", icon: "mt-px size-4" },
  sm: { box: "gap-1.5 px-3 py-2", icon: "mt-0.5 size-3.5" },
} as const;

/** Inline notice (form-level errors, warnings). Announced as an alert. */
export function Callout({
  tone,
  size = "md",
  children,
  className,
}: {
  tone: keyof typeof TONES;
  size?: keyof typeof SIZES;
  children: ReactNode;
  className?: string;
}) {
  const { box, Icon } = TONES[tone];
  const sized = SIZES[size];
  return (
    <div
      role="alert"
      className={cn("flex items-start rounded-lg text-paragraph-xs", sized.box, box, className)}
    >
      <Icon aria-hidden className={cn("shrink-0", sized.icon)} />
      <div>{children}</div>
    </div>
  );
}
