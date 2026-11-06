import { createContext, type ReactNode, useContext, useLayoutEffect } from "react";
import { UserMenu } from "./user-menu";

export type HeaderState = { title: ReactNode; actions?: ReactNode };

export const SetHeaderContext = createContext<((h: HeaderState) => void) | null>(null);

/** Pages set the header title (and optional actions) through this hook; never an in-content h1. */
export function useSetHeader({ title, actions }: HeaderState): void {
  const set = useContext(SetHeaderContext);
  useLayoutEffect(() => {
    set?.({ title, actions });
  }, [set, title, actions]);
}

export function Header({ title, actions }: HeaderState) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b bg-bg-white px-4">
      <h1 className="truncate text-label-md text-text-strong">{title}</h1>
      <div className="flex items-center gap-2">
        {actions}
        {actions ? <span aria-hidden className="h-4 w-px bg-stroke-soft" /> : null}
        <UserMenu />
      </div>
    </header>
  );
}
