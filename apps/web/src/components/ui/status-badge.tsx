import { cva } from "class-variance-authority";
import type { ReactNode } from "react";
import type { IconType } from "react-icons";
import {
  RiCheckboxCircleFill,
  RiCloseCircleFill,
  RiErrorWarningFill,
  RiForbidFill,
  RiInformationFill,
} from "react-icons/ri";

export type Status = "success" | "warning" | "error" | "info" | "neutral";

const statusBadge = cva(
  "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-label-xs [&_svg]:size-4",
  {
    variants: {
      status: {
        success: "bg-success-lighter text-success-base",
        warning: "bg-warning-lighter text-warning-base",
        error: "bg-error-lighter text-error-base",
        info: "bg-information-lighter text-information-base",
        neutral: "bg-faded-lighter text-text-sub",
      },
    },
    defaultVariants: { status: "neutral" },
  },
);

const ICONS: Record<Status, IconType> = {
  success: RiCheckboxCircleFill,
  warning: RiErrorWarningFill,
  error: RiCloseCircleFill,
  info: RiInformationFill,
  neutral: RiForbidFill,
};

export function StatusBadge({
  status = "neutral",
  icon = true,
  children,
}: {
  status?: Status;
  icon?: boolean;
  children: ReactNode;
}) {
  const Icon = ICONS[status];
  return (
    <span data-slot="status-badge" className={statusBadge({ status })}>
      {icon && <Icon aria-hidden />}
      <span>{children}</span>
    </span>
  );
}
