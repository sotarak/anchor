import type { ReactNode } from "react";
import type { IconType } from "react-icons";
import { RiErrorWarningLine, RiFilterOffLine, RiForbidLine } from "react-icons/ri";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";

type Width = "8ch" | "14ch" | "24ch";

/** Loading rows with the real column widths; render inside <TableBody>. */
export function TableSkeletonRows({ columns, rows = 5 }: { columns: Width[]; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
        <TableRow key={r} data-testid="skeleton-row">
          {columns.map((width, c) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder cells
            <TableCell key={c}>
              <Skeleton width={width} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

/** Centered state block (components.md "Empty state"). */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
}: {
  icon: IconType;
  title: string;
  description: ReactNode;
  action?: ReactNode;
  secondaryAction?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-bg-weak ring-1 ring-inset ring-stroke-soft">
        <Icon aria-hidden className="size-6 text-text-soft" />
      </div>
      <div className="flex flex-col items-center gap-1">
        <h3 className="text-label-md text-text-strong">{title}</h3>
        <p className="max-w-[60ch] text-paragraph-sm text-text-soft">{description}</p>
      </div>
      {(action || secondaryAction) && (
        <div className="flex items-center gap-3">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}

export function FilteredEmptyState({ onClear, what }: { onClear: () => void; what: string }) {
  return (
    <EmptyState
      icon={RiFilterOffLine}
      title={`No results match ${what}`}
      description="Try a different search or clear the filters."
      action={
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear filters
        </Button>
      }
    />
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Something went wrong";
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <EmptyState
      icon={RiErrorWarningLine}
      title="Couldn't load this page"
      description={errorMessage(error)}
      action={
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      }
    />
  );
}

export function ForbiddenState({ what }: { what: string }) {
  return (
    <EmptyState
      icon={RiForbidLine}
      title={`You don't have access to ${what}`}
      description="Ask a project or instance admin if you need it."
    />
  );
}
