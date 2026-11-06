import type { ReactNode } from "react";
import { RiErrorWarningFill, RiInformationFill } from "react-icons/ri";
import { cn } from "@/lib/cn";

const TONES = {
  error: { box: "bg-error-lighter text-error-base", Icon: RiErrorWarningFill },
  warning: { box: "bg-warning-lighter text-warning-base", Icon: RiErrorWarningFill },
  information: { box: "bg-information-lighter text-information-base", Icon: RiInformationFill },
} as const;

/** Inline notice (form-level errors, warnings). Announced as an alert. */
export function Callout({
  tone,
  children,
  className,
}: {
  tone: keyof typeof TONES;
  children: ReactNode;
  className?: string;
}) {
  const { box, Icon } = TONES[tone];
  return (
    <div
      role="alert"
      className={cn("flex items-start gap-2 rounded-lg p-3 text-paragraph-xs", box, className)}
    >
      <Icon aria-hidden className="mt-px size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
