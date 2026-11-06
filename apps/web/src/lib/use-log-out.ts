import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ApiClientError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";

/** Ends the current session, then leaves for /login and drops every cached response. */
export function useLogOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async function logOut() {
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
  };
}
