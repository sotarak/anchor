import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { RiLogoutBoxRLine, RiUserLine } from "react-icons/ri";
import { initials } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { meQueryOptions } from "@/lib/auth";
import { useLogOut } from "@/lib/use-log-out";

export function UserMenu() {
  const { data: me } = useQuery(meQueryOptions);
  const logOut = useLogOut();

  if (!me) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="flex size-8 items-center justify-center rounded-full bg-bg-soft text-label-xs text-text-sub outline-none focus-visible:ring-2 focus-visible:ring-primary-base"
      >
        {initials(me.name)}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-56">
        <DropdownMenuLabel>
          <span className="text-label-sm text-text-strong">{me.name}</span>
          <span className="text-paragraph-xs text-text-soft">{me.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/account">
            <RiUserLine />
            Account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void logOut()}>
          <RiLogoutBoxRLine />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
