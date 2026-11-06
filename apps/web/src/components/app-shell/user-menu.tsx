import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { RiLogoutBoxRLine, RiUserLine } from "react-icons/ri";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ApiClientError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { meQueryOptions } from "@/lib/auth";

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
  return letters.map((p) => p?.[0]?.toUpperCase() ?? "").join("") || "?";
}

export function UserMenu() {
  const { data: me } = useQuery(meQueryOptions);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function logOut() {
    try {
      await api.auth.logout();
    } catch (e) {
      // An already-expired session is as good as logged out; anything else is reported.
      if (!(e instanceof ApiClientError && e.status === 401)) {
        toast.error("Could not log out. Try again.");
        return;
      }
    }
    await navigate({ to: "/login" });
    queryClient.clear();
  }

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
