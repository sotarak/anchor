import type { ReactNode } from "react";
import { RiArrowDownSLine } from "react-icons/ri";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The page's primary action with a ▾ for secondary create options. `children` is the main
 * button's content; `menu` holds DropdownMenuItems.
 */
export function SplitButton({
  onClick,
  children,
  menu,
  menuLabel,
}: {
  onClick: () => void;
  children: ReactNode;
  menu: ReactNode;
  menuLabel: string;
}) {
  return (
    <div className="inline-flex">
      <Button variant="primary" size="sm" className="rounded-r-none" onClick={onClick}>
        {children}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="primary"
            size="sm"
            aria-label={menuLabel}
            className="rounded-l-none border-l border-white/20 px-2"
          >
            <RiArrowDownSLine aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>{menu}</DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
