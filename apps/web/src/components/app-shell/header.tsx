import { createContext, type ReactNode, useContext, useLayoutEffect } from "react";
import { RiArrowRightSLine } from "react-icons/ri";
import { UserMenu } from "./user-menu";

/** `parent` renders as a breadcrumb before the title ("Payments API › Production"). */
export type HeaderState = { title: ReactNode; parent?: string; actions?: ReactNode };

export const SetHeaderContext = createContext<((h: HeaderState) => void) | null>(null);

/** Pages set the header title (and optional actions) through this hook; never an in-content h1. */
export function useSetHeader({ title, parent, actions }: HeaderState): void {
  const set = useContext(SetHeaderContext);
  useLayoutEffect(() => {
    set?.({ title, parent, actions });
  }, [set, title, parent, actions]);
}

export function Header({ title, parent, actions }: HeaderState) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b bg-bg-white px-4">
      <h1
        className="flex min-w-0 items-center gap-1 text-label-md text-text-strong"
        // The chevron is decorative; screen readers hear "Parent / Title".
        aria-label={parent && typeof title === "string" ? `${parent} / ${title}` : undefined}
      >
        {parent ? (
          <>
            <span className="truncate text-text-sub">{parent}</span>
            <RiArrowRightSLine aria-hidden className="size-4 shrink-0 text-text-soft" />
          </>
        ) : null}
        <span className="truncate">{title}</span>
      </h1>
      <div className="flex items-center gap-2">
        {actions}
        {actions ? <span aria-hidden className="h-4 w-px bg-stroke-soft" /> : null}
        <UserMenu />
      </div>
    </header>
  );
}
